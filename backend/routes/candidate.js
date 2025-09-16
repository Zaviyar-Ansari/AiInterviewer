const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { supabase } = require('../config/supabase');
const { supabaseAdmin } = require('../config/supabaseAdmin');

// Disable RLS for admin client to bypass row-level security
// This is necessary for insert/update operations that fail due to RLS policies
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const fs = require('fs');
const path = require('path');
const os = require('os');
const fetch = require('node-fetch');

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

const router = express.Router();

// Video conversion function
const convertVideoToMp4 = (inputPath, outputPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp4')
      .videoCodec('libx264')
      .audioCodec('aac')
      .on('end', () => {
        console.log('Video conversion completed successfully');
        resolve();
      })
      .on('error', (err) => {
        console.error('Error during video conversion:', err);
        reject(err);
      })
      .on('progress', (progress) => {
        console.log(`Conversion progress: ${progress.percent}% done`);
      })
      .save(outputPath);
  });
};

// Multer setup for file upload
const upload = multer({ storage: multer.memoryStorage() });

// Middleware to verify auth
const authenticate = async (req, res, next) => {
  try {
    console.log("Authorization header received:", req.headers.authorization);

    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      console.log("No token provided in header");
      return res.status(401).json({ error: 'No token provided' });
    }

    console.log("Token extracted:", token.substring(0, 50) + "...");
    console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
    console.log("SUPABASE_ANON_KEY exists:", !!process.env.SUPABASE_ANON_KEY);

    const { data, error } = await supabase.auth.getUser(token);
    console.log("Supabase auth response:", { data: data ? "user found" : "no user", error });

    if (error) {
      console.error("Auth error details:", error);
      return res.status(401).json({ error: 'Invalid token', details: error.message });
    }

    if (!data.user) {
      console.error("No user data in response");
      return res.status(401).json({ error: 'Invalid token' });
    }

    console.log("User authenticated:", data.user.email);
    req.user = data.user;
    req.token = token; // Store token for user-specific client

    // Create user-specific Supabase client with the user's token
    req.supabaseUser = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

// ---------------- Create Session ----------------
router.post('/session', authenticate, upload.single('video'), async (req, res) => {
  try {
    console.log('Starting session creation...');
    const { title = 'Interview Session' } = req.body;
    const file = req.file;
    const userId = req.user.id;

    console.log('User Email:', req.user.email);
    console.log('File received:', file ? file.originalname : 'No file');
    console.log('File details:', {
      originalname: file?.originalname,
      mimetype: file?.mimetype,
      size: file?.size,
      encoding: file?.encoding
    });

    if (!file) return res.status(400).json({ error: 'No video file provided' });

    // Upload to Supabase Storage in raw/ folder with sessionId in filename
    const sessionId = req.body.sessionId || 'unknownsession';
    const fileName = `raw/${req.user.email}/${sessionId}_${Date.now()}_${file.originalname}`;
    console.log('Uploading to storage:', fileName);
    console.log('File buffer size:', file.buffer.length);
    console.log('Content type being set:', file.mimetype);

    const { error: uploadError } = await supabaseAdmin.storage
      .from('interview-videos')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('interview-videos')
      .getPublicUrl(fileName);
    console.log('Public URL:', urlData.publicUrl);

    // Ensure user exists in users table
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('email', req.user.email)
      .single();

    if (!existingUser) {
      // Insert user if not exists using supabaseAdmin with RLS bypass
      const { error: userInsertError } = await supabaseAdmin
        .from('users')
        .insert([{ id: userId, email: req.user.email, role: 'candidate' }], { returning: 'minimal' });
      if (userInsertError) {
        console.error('User insert error:', userInsertError);
        throw userInsertError;
      }
    }

    // Save to database - video_url will be updated by the conversion process
    const { data: sessionData, error: dbError } = await req.supabaseUser
      .from('interview_sessions')
      .insert([{ user_email: req.user.email, title, status: 'processing', video_url: urlData.publicUrl }])
      .select();

    if (dbError) {
      console.error('Database insert error:', dbError);
      throw dbError;
    }

    // Create conversion record
    const { error: conversionError } = await supabaseAdmin
      .from('conversions')
      .insert([{ 
        filename: fileName, 
        status: 'pending', 
        original_url: urlData.publicUrl 
      }]);

    if (conversionError) {
      console.error('Conversion record creation error:', conversionError);
    }

    // Start video conversion process
    const convertVideo = async (userClient) => {
      try {
        // Update conversion status to converting
        await supabaseAdmin
          .from('conversions')
          .update({ status: 'converting', updated_at: new Date().toISOString() })
          .eq('filename', fileName);

        // Create temporary files
        const tempDir = os.tmpdir();
        const inputPath = path.join(tempDir, `input_${Date.now()}.webm`);
        const outputPath = path.join(tempDir, `output_${Date.now()}.mp4`);

        // Download the webm file
        const { data: fileData, error: downloadError } = await supabaseAdmin.storage
          .from('interview-videos')
          .download(fileName);

        if (downloadError || !fileData) {
          throw new Error(`Failed to download file: ${downloadError?.message}`);
        }

        // Write to temporary file
        fs.writeFileSync(inputPath, Buffer.from(await fileData.arrayBuffer()));

        // Convert to MP4
        await convertVideoToMp4(inputPath, outputPath);

        // Read converted file
        const convertedBuffer = fs.readFileSync(outputPath);

        // Upload converted MP4 to converted/ folder
        const mp4FileName = fileName.replace('raw/', 'converted/').replace('.webm', '.mp4');
        const { error: uploadMp4Error } = await supabaseAdmin.storage
          .from('interview-videos')
          .upload(mp4FileName, convertedBuffer, {
            contentType: 'video/mp4',
            upsert: true
          });

        if (uploadMp4Error) {
          throw new Error(`Failed to upload MP4: ${uploadMp4Error.message}`);
        }

        // Get MP4 public URL
        const { data: mp4UrlData } = supabaseAdmin.storage
          .from('interview-videos')
          .getPublicUrl(mp4FileName);

        // Update conversion record
        await supabaseAdmin
          .from('conversions')
          .update({
            status: 'completed',
            converted_url: mp4UrlData.publicUrl,
            updated_at: new Date().toISOString()
          })
          .eq('filename', fileName);

        // Update session with MP4 URL and status
        await supabaseAdmin
          .from('interview_sessions')
          .update({
            video_url: mp4UrlData.publicUrl,
            status: 'uploaded',
            updated_at: new Date().toISOString()
          })
          .eq('id', sessionData[0].id);

        // Clean up temporary files
        try {
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputPath);
        } catch (cleanupError) {
          console.warn('Failed to clean up temporary files:', cleanupError);
        }

        console.log('Video conversion completed successfully');
      } catch (conversionError) {
        console.error('Video conversion failed:', conversionError);

        // Update conversion status to failed
        await supabaseAdmin
          .from('conversions')
          .update({
            status: 'failed',
            error_message: conversionError.message,
            updated_at: new Date().toISOString()
          })
          .eq('filename', fileName);

        // Update session status to failed
        await supabaseAdmin
          .from('interview_sessions')
          .update({
            status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', sessionData[0].id);
      }
    };

    // Start conversion asynchronously
    convertVideo(req.supabaseUser);

    res.status(201).json({
      message: 'Session created - video conversion in progress',
      session: sessionData[0],
      conversion_status: 'queued'
    });
  } catch (error) {
    console.error('Session creation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ---------------- Get session status ----------------
router.get('/session/:id/status', authenticate, async (req, res) => {
  const { id } = req.params;
  res.json({ id, status: 'completed', message: 'Session is ready' });
});

// ---------------- Get user's sessions ----------------
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const { data, error } = await req.supabaseUser
      .from('interview_sessions')
      .select('*')
      .eq('user_email', req.user.email);
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------- Get user's conversions ----------------
router.get('/conversions', authenticate, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversions')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------- Delete session ----------------
router.delete('/session/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: session, error: fetchError } = await supabase
      .from('interview_sessions')
      .select('*')
      .eq('id', id)
      .eq('user_email', req.user.email)
      .single();

    if (fetchError || !session) return res.status(404).json({ error: 'Session not found' });

    const fileName = session.video_url.split('/').pop();
    await supabaseAdmin.storage.from('interview-videos').remove([fileName]);

    const { error } = await supabase
      .from('interview_sessions')
      .delete()
      .eq('id', id);
    if (error) throw error;

    res.json({ message: 'Session deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------- Upload video for existing session ----------------
router.post('/upload', authenticate, upload.single('video'), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const file = req.file;
    const userEmail = req.user.email;

    if (!file || !sessionId) return res.status(400).json({ error: 'Video file and sessionId required' });

    const { data: session, error: fetchError } = await supabase
      .from('interview_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_email', userEmail)
      .single();

    if (fetchError || !session) return res.status(404).json({ error: 'Session not found' });

    const fileName = `raw/${userEmail}/${sessionId}_${file.originalname}`;
    const { error: uploadError } = await supabaseAdmin.storage
      .from('interview-videos')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
      });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabaseAdmin.storage
      .from('interview-videos')
      .getPublicUrl(fileName);

    const { error: updateError } = await supabase
      .from('interview_sessions')
      .update({ video_url: urlData.publicUrl })
      .eq('id', sessionId);
    if (updateError) throw updateError;

    res.json({ message: 'Video uploaded', video_url: urlData.publicUrl });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------- Test endpoint for debugging ----------------
router.get('/test', async (req, res) => {
  try {
    console.log('Testing Supabase configuration...');
    console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'Not set');
    console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? 'Set' : 'Not set');
    console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Set' : 'Not set');

    // Test storage bucket access
    try {
      const { data: buckets, error: bucketError } = await supabaseAdmin.storage.listBuckets();
      console.log('Storage buckets:', buckets);
      if (bucketError) {
        console.error('Storage bucket error:', bucketError);
      }
    } catch (storageErr) {
      console.error('Storage test failed:', storageErr);
    }

    res.json({
      message: 'Test completed',
      env: {
        supabaseUrl: !!process.env.SUPABASE_URL,
        anonKey: !!process.env.SUPABASE_ANON_KEY,
        serviceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    });
  } catch (error) {
    console.error('Test error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
