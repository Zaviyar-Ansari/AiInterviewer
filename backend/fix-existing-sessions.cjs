#!/usr/bin/env node

/**
 * Script to fix existing interview sessions stuck in "processing" status
 * This script will:
 * 1. Find all sessions with status "processing" 
 * 2. Check if corresponding converted MP4 files exist in Supabase storage
 * 3. Update session status to "uploaded" and video_url to the converted MP4 URL
 * 4. Create/update conversion records accordingly
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase client with service role key for admin access
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixExistingSessions() {
  try {
    console.log('🔍 Finding sessions with processing status...');
    
    // Get all sessions with processing status
    const { data: processingSessions, error: fetchError } = await supabase
      .from('interview_sessions')
      .select('*')
      .eq('status', 'processing');

    if (fetchError) {
      console.error('Error fetching processing sessions:', fetchError);
      return;
    }

    console.log(`📊 Found ${processingSessions.length} sessions in processing status`);

    if (processingSessions.length === 0) {
      console.log('✅ No sessions need fixing');
      return;
    }

    // List all files in the converted folder
    console.log('📂 Listing files in converted folder...');
    const { data: convertedFiles, error: listError } = await supabase.storage
      .from('interview-videos')
      .list('converted', {
        limit: 1000,
        sortBy: { column: 'created_at', order: 'desc' }
      });

    if (listError) {
      console.error('Error listing converted files:', listError);
      return;
    }

    console.log(`📁 Found ${convertedFiles.length} files in converted folder`);

    // Process each session
    for (const session of processingSessions) {
      console.log(`\n🔧 Processing session ${session.id} for user ${session.user_email}...`);
      
      if (!session.video_url) {
        console.log('⚠️  Session has no video_url, skipping');
        continue;
      }

      // Extract original filename pattern from raw video URL
      const originalUrl = session.video_url;
      const urlParts = originalUrl.split('/');
      
      // Look for pattern: raw/{email}/{sessionId}_{timestamp}_{originalName}.webm
      let rawFileName = null;
      if (originalUrl.includes('/raw/')) {
        // Get the part after /raw/
        const rawIndex = urlParts.findIndex(part => part === 'raw');
        if (rawIndex >= 0 && rawIndex < urlParts.length - 2) {
          const email = urlParts[rawIndex + 1];
          const filename = urlParts[rawIndex + 2];
          rawFileName = `raw/${email}/${filename}`;
        }
      }

      if (!rawFileName) {
        console.log('⚠️  Could not extract raw filename pattern, skipping');
        continue;
      }

      // Look for corresponding converted file
      // Convert raw filename to converted filename: raw/{email}/{file}.webm -> converted/{email}/{file}.mp4
      const convertedFileName = rawFileName.replace('raw/', 'converted/').replace('.webm', '.mp4');
      const convertedFileBasename = convertedFileName.split('/').pop();
      
      console.log(`🔍 Looking for converted file: ${convertedFileBasename}`);
      
      // Check if converted file exists
      const convertedFileExists = convertedFiles.some(file => 
        file.name === convertedFileBasename || 
        file.name.includes(session.id.substring(0, 8)) // Match by session ID prefix
      );

      if (!convertedFileExists) {
        // Try to find any MP4 file that might correspond to this session
        const possibleFiles = convertedFiles.filter(file => 
          file.name.includes('.mp4') && 
          (file.name.includes(session.user_email.split('@')[0]) || 
           file.name.includes(session.id.substring(0, 8)))
        );
        
        if (possibleFiles.length === 0) {
          console.log('❌ No converted file found, skipping');
          continue;
        }
        
        console.log(`🎯 Found possible converted file(s):`, possibleFiles.map(f => f.name));
        // Use the first match
        convertedFileBasename = possibleFiles[0].name;
      }

      // Get public URL for converted file
      const convertedPath = `converted/${session.user_email}/${convertedFileBasename}`;
      const { data: urlData } = supabase.storage
        .from('interview-videos')
        .getPublicUrl(convertedPath);

      const convertedUrl = urlData.publicUrl;
      
      console.log(`📹 Converted URL: ${convertedUrl}`);

      // Test if the converted file is actually accessible
      try {
        const response = await fetch(convertedUrl, { method: 'HEAD' });
        if (!response.ok) {
          console.log(`❌ Converted file not accessible (${response.status}), skipping`);
          continue;
        }
        console.log(`✅ Converted file is accessible`);
      } catch (error) {
        console.log(`❌ Error accessing converted file: ${error.message}, skipping`);
        continue;
      }

      // Update session with converted video URL and status
      console.log('📝 Updating session...');
      const { error: updateError } = await supabase
        .from('interview_sessions')
        .update({
          video_url: convertedUrl,
          status: 'uploaded',
          updated_at: new Date().toISOString()
        })
        .eq('id', session.id);

      if (updateError) {
        console.error(`❌ Error updating session: ${updateError.message}`);
        continue;
      }

      // Create or update conversion record
      console.log('📝 Creating/updating conversion record...');
      const { error: conversionError } = await supabase
        .from('conversions')
        .upsert({
          filename: rawFileName,
          status: 'completed',
          original_url: originalUrl,
          converted_url: convertedUrl,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'filename'
        });

      if (conversionError) {
        console.error(`⚠️  Error creating conversion record: ${conversionError.message}`);
        // Continue anyway as the main update succeeded
      }

      console.log(`✅ Successfully fixed session ${session.id}`);
    }

    console.log('\n🎉 Session fixing completed!');
    
    // Summary
    const { data: updatedSessions } = await supabase
      .from('interview_sessions')
      .select('status')
      .eq('status', 'uploaded');
      
    console.log(`📊 Total sessions now in 'uploaded' status: ${updatedSessions?.length || 0}`);

  } catch (error) {
    console.error('💥 Script error:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  fixExistingSessions().then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });
}

module.exports = { fixExistingSessions };