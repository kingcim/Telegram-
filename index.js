require('dotenv').config();
const { Telegraf } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
const CryptoJS = require('crypto-js');
const mime = require('mime-types');
const axios = require('axios');

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
fs.ensureDirSync(tempDir);

// Clean temp files older than 1 minute
setInterval(() => {
  fs.readdir(tempDir, (err, files) => {
    if (err) return;
    
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.birthtimeMs > 60000) { // 1 minute
        fs.unlinkSync(filePath);
      }
    });
  });
}, 30000); // Check every 30 seconds

const bot = new Telegraf(process.env.BOT_TOKEN);

// Helper functions
function generateKey(bits = 32) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
  let key = '';
  const length = bits / 8; // Convert bits to bytes
  
  for (let i = 0; i < length; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return key;
}

function encryptText(text, key) {
  return CryptoJS.AES.encrypt(text, key).toString();
}

function decryptText(encryptedText, key) {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedText, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    return null;
  }
}

async function encryptFile(filePath, key) {
  const fileContent = await fs.readFile(filePath);
  const encrypted = CryptoJS.AES.encrypt(
    CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(fileContent.toString('base64'))), 
    key
  ).toString();
  return encrypted;
}

async function decryptFile(encryptedContent, key, originalMimeType) {
  try {
    const bytes = CryptoJS.AES.decrypt(encryptedContent, key);
    const decrypted = CryptoJS.enc.Base64.parse(bytes.toString(CryptoJS.enc.Utf8)).toString(CryptoJS.enc.Utf8);
    const buffer = Buffer.from(decrypted, 'base64');
    return buffer;
  } catch (error) {
    return null;
  }
}

async function obfuscateJsFile(filePath) {
  try {
    const fileContent = await fs.readFile(filePath, 'utf8');
    const response = await axios.get('https://apis.davidcyriltech.my.id/obfuscate', {
      params: {
        code: fileContent,
        level: 'low'
      }
    });
    
    if (response.data && response.data.obfuscated) {
      return response.data.obfuscated;
    }
    return null;
  } catch (error) {
    console.error('Obfuscation API error:', error);
    return null;
  }
}

// Bot commands
bot.start((ctx) => {
  ctx.replyWithMarkdown(`
👋 *Welcome to SilentByte Ancrypt* 🔐

*Developed by Iconic Tech*

📌 *Available Commands:*
/encrypt - Encrypt text or files
/decrypt - Decrypt text or files
/keygen - Generate a secure key
/devinfo - Developer information

🔒 All files are automatically deleted after 1 minute for security.
  `);
});

bot.command('devinfo', (ctx) => {
  ctx.reply('🛠 *SilentByte Ancrypt*\n\nDeveloped by *Iconic Tech*', { parse_mode: 'Markdown' });
});

bot.command('keygen', (ctx) => {
  ctx.replyWithMarkdown(`
🔑 *Choose key strength:*
/32bitkey - 32-bit secure key
/64bitkey - 64-bit secure key
  `);
});

bot.command('32bitkey', (ctx) => {
  ctx.reply(`🔑 Your 32-bit key:\n\n${generateKey(32)}\n\n⚠️ Save this key securely! You'll need it for decryption.`);
});

bot.command('64bitkey', (ctx) => {
  ctx.reply(`🔑 Your 64-bit key:\n\n${generateKey(64)}\n\n⚠️ Save this key securely! You'll need it for decryption.`);
});

bot.command('encrypt', async (ctx) => {
  ctx.reply('📝 Send me the text you want to encrypt or upload a file (JS files will be obfuscated first).');
  
  // Wait for user input
  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return; // Ignore commands
    
    ctx.reply('🔑 Please send me an encryption key or use /keygen to generate one.');
    
    bot.once('text', (ctx) => {
      const key = ctx.message.text;
      if (key.startsWith('/')) return;
      
      const encrypted = encryptText(text, key);
      ctx.replyWithMarkdown(`
🔐 *Encrypted Text:*
\`\`\`
${encrypted}
\`\`\`
      
🔑 *Key used:* ||${key}|| (hidden for security)
      `);
    });
  });
});

bot.command('decrypt', (ctx) => {
  ctx.reply('🔓 Send me the encrypted text you want to decrypt.');
  
  bot.once('text', (ctx) => {
    const encryptedText = ctx.message.text;
    if (encryptedText.startsWith('/')) return;
    
    ctx.reply('🔑 Now send me the decryption key.');
    
    bot.once('text', (ctx) => {
      const key = ctx.message.text;
      if (key.startsWith('/')) return;
      
      const decrypted = decryptText(encryptedText, key);
      if (decrypted) {
        ctx.replyWithMarkdown(`
🔓 *Decrypted Text:*
\`\`\`
${decrypted}
\`\`\`
        `);
      } else {
        ctx.reply('❌ Decryption failed! Please check your key and try again.');
      }
    });
  });
});

// File handling
bot.on('document', async (ctx) => {
  const fileId = ctx.message.document.file_id;
  const fileName = ctx.message.document.file_name;
  const mimeType = ctx.message.document.mime_type;
  const fileExt = path.extname(fileName);
  
  try {
    // Download the file
    const fileLink = await ctx.telegram.getFileLink(fileId);
    const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const fileBuffer = Buffer.from(response.data, 'binary');
    
    const tempFilePath = path.join(tempDir, fileName);
    await fs.writeFile(tempFilePath, fileBuffer);
    
    // Check if it's a JS file for obfuscation
    if (fileExt.toLowerCase() === '.js') {
      ctx.reply('🔄 Detected JS file - obfuscating before encryption...');
      
      const obfuscatedCode = await obfuscateJsFile(tempFilePath);
      if (obfuscatedCode) {
        await fs.writeFile(tempFilePath, obfuscatedCode);
        ctx.reply('✅ JavaScript file obfuscated successfully!');
      } else {
        ctx.reply('⚠️ Obfuscation failed, proceeding with original file.');
      }
    }
    
    ctx.reply('🔑 Please send me an encryption key or use /keygen to generate one.');
    
    bot.once('text', async (ctx) => {
      const key = ctx.message.text;
      if (key.startsWith('/')) return;
      
      ctx.reply('🔐 Encrypting your file...');
      
      try {
        const encryptedContent = await encryptFile(tempFilePath, key);
        const encryptedFileName = `encrypted_${path.basename(fileName, fileExt)}.ancrypt`;
        const encryptedFilePath = path.join(tempDir, encryptedFileName);
        
        await fs.writeFile(encryptedFilePath, encryptedContent);
        
        await ctx.replyWithDocument({
          source: encryptedFilePath,
          filename: encryptedFileName
        }, {
          caption: `🔐 Your encrypted file\n\n🔑 Key used: ||${key}|| (hidden for security)\n\n⚠️ This file will be deleted from our servers in 1 minute.`
        });
        
        // Schedule file deletion
        setTimeout(() => {
          fs.unlink(encryptedFilePath).catch(() => {});
        }, 60000);
      } catch (error) {
        console.error(error);
        ctx.reply('❌ Error encrypting file. Please try again.');
      } finally {
        fs.unlink(tempFilePath).catch(() => {});
      }
    });
  } catch (error) {
    console.error(error);
    ctx.reply('❌ Error processing file. Please try again.');
  }
});

// Handle encrypted file decryption
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  
  // Check if this might be an encrypted file content
  if (text.length > 100 && ctx.message.reply_to_message) {
    const repliedMsg = ctx.message.reply_to_message;
    if (repliedMsg.text && repliedMsg.text.includes('encrypted file')) {
      ctx.reply('🔑 Please send me the decryption key for this file.');
      
      bot.once('text', async (ctx) => {
        const key = ctx.message.text;
        if (key.startsWith('/')) return;
        
        try {
          const decryptedContent = await decryptFile(text, key, 'application/octet-stream');
          if (!decryptedContent) {
            return ctx.reply('❌ Decryption failed! Invalid key or corrupted data.');
          }
          
          // Try to determine original file type
          const fileName = `decrypted_file_${Date.now()}.bin`;
          const decryptedFilePath = path.join(tempDir, fileName);
          
          await fs.writeFile(decryptedFilePath, decryptedContent);
          
          await ctx.replyWithDocument({
            source: decryptedFilePath,
            filename: fileName
          }, {
            caption: '🔓 Your decrypted file\n\n⚠️ This file will be deleted from our servers in 1 minute.'
          });
          
          // Schedule file deletion
          setTimeout(() => {
            fs.unlink(decryptedFilePath).catch(() => {});
          }, 60000);
        } catch (error) {
          console.error(error);
          ctx.reply('❌ Error decrypting file. Please check your key and try again.');
        }
      });
    }
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
  ctx.reply('❌ An error occurred. Please try again.');
});

// Start bot
if (process.env.NODE_ENV === 'production') {
  bot.launch({
    webhook: {
      domain: process.env.WEBHOOK_DOMAIN,
      port: process.env.PORT || 3000
    }
  });
} else {
  bot.launch();
}

console.log('🤖 SilentByte Ancrypt bot is running...');

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));