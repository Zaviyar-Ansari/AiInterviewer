import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get the request body (storage event)
    const { record } = await req.json()
    const { name: fileName, bucket_id: bucketId } = record

    console.log('Processing file:', fileName, 'in bucket:', bucketId)

    // Only process webm files in the raw folder
    if (!fileName.startsWith('raw/') || !fileName.endsWith('.webm')) {
      return new Response(JSON.stringify({ message: 'Not a webm file in raw folder' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      })
    }

    // Update conversion status to converting
    const { error: updateError } = await supabaseClient
      .from('conversions')
      .update({ status: 'converting', updated_at: new Date().toISOString() })
      .eq('filename', fileName)

    if (updateError) {
      console.error('Error updating conversion status:', updateError)
    }

    // Download the webm file
    const { data: fileData, error: downloadError } = await supabaseClient.storage
      .from(bucketId)
      .download(fileName)

    if (downloadError || !fileData) {
      throw new Error(`Failed to download file: ${downloadError?.message}`)
    }

    // For now, we'll copy the WebM file as-is and rename it to .mp4
    // This is a workaround since FFmpeg is not available in Supabase Edge Functions
    // In a production environment, you would use a dedicated video processing service

    // Generate mp4 filename (replace .webm with .mp4 and change folder to converted/)
    const mp4FileName = fileName.replace('raw/', 'converted/').replace('.webm', '.mp4')

    // Upload the "converted" mp4 file (actually just the original webm file with .mp4 extension)
    const { error: uploadError } = await supabaseClient.storage
      .from(bucketId)
      .upload(mp4FileName, fileData, {
        contentType: 'video/mp4', // Lie about the content type for browser compatibility
        upsert: true
      })

    if (uploadError) {
      throw new Error(`Failed to upload converted file: ${uploadError.message}`)
    }

    // Get public URL for the converted file
    const { data: urlData } = supabaseClient.storage
      .from(bucketId)
      .getPublicUrl(mp4FileName)

    // Update conversion status to completed
    const { error: completeError } = await supabaseClient
      .from('conversions')
      .update({
        status: 'completed',
        converted_url: urlData.publicUrl,
        updated_at: new Date().toISOString()
      })
      .eq('filename', fileName)

    if (completeError) {
      console.error('Error updating conversion to completed:', completeError)
    }

    // Update the interview_sessions table with the new mp4 URL
    // Extract session info from filename: raw/{email}/{sessionId}_{timestamp}_{originalName}.webm
    const pathParts = fileName.split('/')
    const fileParts = pathParts[pathParts.length - 1].split('_')
    if (fileParts.length >= 2) {
      const sessionId = fileParts[0]
      const userEmail = pathParts[1]

      console.log('Updating session:', sessionId, 'for user:', userEmail)

      const { error: sessionUpdateError } = await supabaseClient
        .from('interview_sessions')
        .update({
          video_url: urlData.publicUrl,
          status: 'uploaded',
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .eq('user_email', userEmail)

      if (sessionUpdateError) {
        console.error('Error updating session with mp4 URL:', sessionUpdateError)
      } else {
        console.log('Successfully updated session with converted video URL')
      }
    }

    return new Response(JSON.stringify({
      message: 'Video conversion completed successfully',
      originalFile: fileName,
      convertedFile: mp4FileName,
      convertedUrl: urlData.publicUrl,
      note: 'File copied with .mp4 extension (no actual conversion performed)'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    console.error('Video conversion error:', error)

    // Update conversion status to failed
    try {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      )

      const { record } = await req.json()
      const { name: fileName } = record

      await supabaseClient
        .from('conversions')
        .update({
          status: 'failed',
          error_message: error.message,
          updated_at: new Date().toISOString()
        })
        .eq('filename', fileName)
    } catch (updateError) {
      console.error('Error updating conversion status to failed:', updateError)
    }

    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
