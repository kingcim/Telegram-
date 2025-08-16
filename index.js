const TelegramBot = require("node-telegram-bot-api");
// Add at the top of your file
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
// Replace const config = require("./config.js");
// Replace the config.js import with:
require('dotenv').config(); // Add this at the top
const token = process.env.TOKEN;
const bot = new TelegramBot(token, { polling: true });
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const P = require("pino");

const sessions = new Map();
const SESSIONS_DIR = "./sessions";
const ACTIVE_NUMBERS_FILE = "./sessions/active_numbers.json";

function createSessionDir(botNumber) {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
  return SESSIONS_DIR;
}

function saveActiveNumbers(numbers) {
  const limitedNumbers = numbers.slice(0, 1);
  fs.writeFileSync(ACTIVE_NUMBERS_FILE, JSON.stringify(limitedNumbers));
}

function loadActiveNumbers() {
  try {
    if (fs.existsSync(ACTIVE_NUMBERS_FILE)) {
      const numbers = JSON.parse(fs.readFileSync(ACTIVE_NUMBERS_FILE));
      return numbers.slice(0, 1);
    }
  } catch (error) {
    console.error("Error loading active numbers:", error);
  }
  return [];
}

async function initializeWhatsAppConnections() {
  try {
    const activeNumbers = loadActiveNumbers();
    for (const botNumber of activeNumbers) {
      const sessionDir = createSessionDir(botNumber);
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

      const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: P({ level: "silent" }),
        defaultQueryTimeoutMs: undefined,
      });

      await new Promise((resolve, reject) => {
        sock.ev.on("connection.update", async (update) => {
          const { connection, lastDisconnect } = update;
          if (connection === "open") {
            console.log(`BOT Number : ${botNumber} udah terkonek nih masbroo!`);
            sessions.set(botNumber, sock);
            const activeNumbers = loadActiveNumbers();
            if (!activeNumbers.includes(botNumber)) {
              activeNumbers.push(botNumber);
              saveActiveNumbers(activeNumbers);
            }
            resolve();
          } else if (connection === "close") {
            const shouldReconnect =
              lastDisconnect?.error?.output?.statusCode !==
              DisconnectReason.loggedOut;
            if (shouldReconnect) {
              console.log(`Mencoba menghubungkan ulang bot ${botNumber}...`);
              await initializeWhatsAppConnections();
            } else {
              reject(new Error("Koneksi ditutup"));
            }
          }
        });

        sock.ev.on("creds.update", saveCreds);
      });
    }
  } catch (error) {
    console.error(error);
  }
}

async function connectToWhatsApp(botNumber, chatId) {
  const activeNumbers = loadActiveNumbers();
  if (activeNumbers.length > 0) {
    await bot.sendMessage(
      chatId,
      `╭─────────────────
│    *BOT SUDAH TERHUBUNG*    
│────────────────
│ ❌ udah ada nomor yang terkonek masbroo!
│ 📱 Nomor: ${activeNumbers[0]}
╰─────────────────`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  let statusMessage = await bot
    .sendMessage(
      chatId,
      `╭─────────────────
│ Bot: ${botNumber}
│ Status: Check Dlu Nih...
╰─────────────────`,
      { parse_mode: "Markdown" }
    )
    .then((msg) => msg.message_id);

  const sessionDir = createSessionDir(botNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: "silent" }),
    defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        const activeNumbers = loadActiveNumbers();
        const updatedNumbers = activeNumbers.filter((num) => num !== botNumber);
        saveActiveNumbers(updatedNumbers);
      }
      if (statusCode && statusCode >= 500 && statusCode < 600) {
        await bot.editMessageText(
          `╭─────────────────
│ Bot: ${botNumber}
│ Status: Sabar ya masbroo...
╰─────────────────`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
        await connectToWhatsApp(botNumber, chatId);
      } else {
        await bot.editMessageText(
          `╭─────────────────
│ Bot: ${botNumber}
│ Status: Failed Jirrr, coba lagi dah!
╰─────────────────`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (error) {
          console.error("Error deleting session:", error);
        }
      }
    } else if (connection === "open") {
      sessions.set(botNumber, sock);
      const activeNumbers = loadActiveNumbers();
      if (!activeNumbers.includes(botNumber)) {
        activeNumbers.push(botNumber);
        saveActiveNumbers(activeNumbers);
      }
      await bot.editMessageText(
        `╭─────────────────
│ Bot: ${botNumber}
│ Status: Aanjayyy Konek Success!
╰─────────────────`,
        {
          chat_id: chatId,
          message_id: statusMessage,
          parse_mode: "Markdown",
        }
      );
    } else if (connection === "connecting") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        if (!fs.existsSync(`${sessionDir}/creds.json`)) {
          const code = await sock.requestPairingCode(botNumber);
          const formattedCode = code.match(/.{1,4}/g)?.join("-") || code;
          await bot.editMessageText(
            `╭─────────────────
│    *Nih Code Pairing nya*    
│────────────────
│ Bot: ${botNumber}
│ Kode: ${formattedCode}
╰─────────────────`,
            {
              chat_id: chatId,
              message_id: statusMessage,
              parse_mode: "Markdown",
            }
          );
        }
      } catch (error) {
        console.error("Error requesting pairing code:", error);
        await bot.editMessageText(
          `╭─────────────────
│    *ERROR NIH*    
│────────────────
│ Bot: ${botNumber}
│ Pesan: ${error.message}
╰─────────────────`,
          {
            chat_id: chatId,
            message_id: statusMessage,
            parse_mode: "Markdown",
          }
        );
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  return sock;
}

async function initializeBot() {
  console.log("╭───────────────────────────────────────────────────");
  console.log("│>                 # ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ          ");
  console.log("│───────────────────────────────────────────────────");
  console.log("│>               𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊                 ");
  console.log("│>              Initialization in Progress...      ");
  console.log("╰───────────────────────────────────────────────────");

  await initializeWhatsAppConnections();
  console.log("│> WhatsApp connections initialized successfully. ");
  console.log("╰───────────────────────────────────────────────────");
}

initializeBot();
// Add this right after your bot initialization
// Simple welcome message for new members
// Handle new members joining
bot.on("chat_member", async (msg) => {
  const chatId = msg.chat.id;
  const newMember = msg.new_chat_member;
  const oldMember = msg.old_chat_member;

  // Check if it's a new member joining
  if (newMember?.status === "member" && oldMember?.status === "left") {
    const userName = newMember.user.first_name || "User";
    
    // Send welcome message (customize as needed)
    await bot.sendMessage(
      chatId,
      `🎉 Welcome, *${userName}*! Enjoy your stay in the group.`,
      { parse_mode: "Markdown" }
    );
  }
});
   //antlink
   bot.on('message', async (msg) => {
    if (!msg.text) return;
    console.log('Processing message:', msg.text); // Debug log

    const chatId = msg.chat.id;
    const isGroup = ['group', 'supergroup'].includes(msg.chat.type);
    
    if (!isGroup) return;

    // Check if sender is admin or creator
    try {
        const member = await bot.getChatMember(chatId, msg.from.id);
        if (['administrator', 'creator'].includes(member.status)) {
            return; // Skip if user is admin or creator
        }
    } catch (error) {
        console.error('Error checking user status:', error);
        return;
    }

    // Simple link detection
    if (/(https?:\/\/|www\.)/i.test(msg.text)) {
        try {
            console.log('Link detected - deleting...'); // Debug log
            await bot.deleteMessage(chatId, msg.message_id);
            
            // Send warning message and store it in a variable
            const sentMessage = await bot.sendMessage(chatId, '⚠️ Links are not allowed here!');
            
            // Delete the warning message after 2 seconds
            setTimeout(async () => {
                try {
                    await bot.deleteMessage(chatId, sentMessage.message_id);
                } catch (error) {
                    console.error('Error deleting warning message:', error);
                }
            }, 2000);
        } catch (error) {
            console.error('Anti-link error:', error);
        }
    }
});
//ANTIBAD
bot.on('message', async (msg) => {
    if (!msg.text) return;

    const chatId = msg.chat.id;
    const isGroup = ['group', 'supergroup'].includes(msg.chat.type);
    if (!isGroup) return;

    // Skip if sender is admin/creator
    try {
        const member = await bot.getChatMember(chatId, msg.from.id);
        if (['administrator', 'creator'].includes(member.status)) return;
    } catch (error) {
        console.error('Error checking admin status:', error);
        return;
    }

    // Bad words list (customize as needed)
    const badWords = [
    'porn', 'xxx', 'sex', 'tities', 'titties', 'nude', 'nsfw', 'hentai', 'adult', 'erotic',
    'pornography', 'sexy', 'fuck', 'dick', 'cock', 'pussy', 'ass', 'boobs',
    'tits', 'naked', 'nudes', 'blowjob', 'cum', 'suck', 'fucking', 'anal',
    'vagina', 'penis', 'bdsm', 'fetish', 'hardcore', 'masturbation'
  ];
    const hasBadWord = badWords.some(word => 
        new RegExp(`\\b${word}\\b`, 'i').test(msg.text) // Whole word matching
    );

    if (hasBadWord) {
        try {
            // Delete the offensive message
            await bot.deleteMessage(chatId, msg.message_id);
            
            // Send branded warning
            const warning = await bot.sendMessage(
                chatId,
                `👑 *Queen Ruva AI Beta Warning* 👑\n\n` +
                `@${msg.from.username || msg.from.first_name}, ` +
                `your message contained inappropriate language.\n\n` +
                `_This is your first warning. Continued violations may result in removal._`,
                { parse_mode: 'Markdown' }
            );

            // Delete warning after 5 seconds
            setTimeout(async () => {
                try {
                    await bot.deleteMessage(chatId, warning.message_id);
                } catch (error) {
                    console.error('Error cleaning up warning:', error);
                }
            }, 5000);

        } catch (error) {
            console.error('Error handling bad word:', error);
            bot.sendMessage(
                chatId,
                `⚠️ *Queen Ruva AI Beta Alert* ⚠️\n` +
                `Could not process a rule violation. Please report to admins.`,
                { parse_mode: 'Markdown' }
            );
        }
    }
});
//private
bot.on('message', async (msg) => {
    if (!msg.text) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const isPrivate = msg.chat.type === 'private';

    // Bad words list (customize as needed)
    const badWords = [
    'porn', 'xxx', 'sex', 'tities', 'titties', 'nude', 'nsfw', 'hentai', 'adult', 'erotic',
    'pornography', 'sexy', 'fuck', 'dick', 'cock', 'pussy', 'ass', 'boobs',
    'tits', 'naked', 'nudes', 'blowjob', 'cum', 'suck', 'fucking', 'anal',
    'vagina', 'penis', 'bdsm', 'fetish', 'hardcore', 'masturbation'
  ];
    const hasBadWord = badWords.some(word => 
        new RegExp(`\\b${word}\\b`, 'i').test(msg.text) // Whole word matching
    );

    if (hasBadWord) {
        try {
            // Delete the offensive message (if not private chat)
            if (!isPrivate) {
                await bot.deleteMessage(chatId, msg.message_id);
            }

            // Different response for groups vs private
            if (isPrivate) {
                // Inbox (private chat) warning
                await bot.sendMessage(
                    chatId,
                    `👑 *Queen Ruva AI Beta Notice* 👑\n\n` +
                    `Your message contained language that violates our community guidelines.\n\n` +
                    `Please maintain respectful communication. Repeated violations may result in restrictions.`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                // Group chat warning
                const warning = await bot.sendMessage(
                    chatId,
                    `👑 *Queen Ruva AI Beta Warning* 👑\n\n` +
                    `@${msg.from.username || msg.from.first_name}, ` +
                    `your message contained inappropriate language.\n\n` +
                    `_This content has been removed. Continued violations may result in removal._`,
                    { parse_mode: 'Markdown' }
                );

                // Delete warning after 5 seconds in groups
                setTimeout(async () => {
                    try {
                        await bot.deleteMessage(chatId, warning.message_id);
                    } catch (error) {
                        console.error('Error cleaning up warning:', error);
                    }
                }, 5000);
            }

        } catch (error) {
            console.error('Error handling bad word:', error);
            if (!isPrivate) {
                bot.sendMessage(
                    chatId,
                    `⚠️ *Queen Ruva AI Beta Alert* ⚠️\n` +
                    `Could not process a rule violation. Please report to admins.`,
                    { parse_mode: 'Markdown' }
                );
            }
        }
    }
});
//stop
bot.on("message", async (msg) => {
  let sock;
  if (sessions.size > 0) {
    [_, sock] = Array.from(sessions.entries())[0];
  }
  const chatId = msg.chat.id;
  
  if (!msg.text) {
    bot.sendMessage(
      chatId,
      `╭─────────────────
│    *INVALID MESSAGE*    
│────────────────
│ ❌ Only text messages can be processed
╰─────────────────`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const command = msg.text.split(" ")[0].toLowerCase().replace("/", "");

  switch (command) {
case "start":
{
  const thumbnailUrl = "https://files.catbox.moe/hgf31q.jpg"; // Your thumbnail URL
  const audioFilePath = "./ruva.mp3"; // Replace with your audio file path
  const progressMessages = [
    "Loading...",
    "Almost there...",
    "Almost done...",
    "Finalizing...",
    "Completed",
    "LOADING COMPLETED 🤖....."
  ];

  let lastMessageId = null;

  // Show typing indicator
  bot.sendChatAction(chatId, 'typing');

  // Loading messages with delay
  setTimeout(() => {
    progressMessages.forEach((message, i) => {
      setTimeout(() => {
        bot.sendMessage(chatId, `⌛ ${message}`).then((sentMessage) => {
          // Delete previous message
          if (lastMessageId) {
            bot.deleteMessage(chatId, lastMessageId).catch(() => {});
          }
          lastMessageId = sentMessage.message_id;
        });
      }, i * 1500); // 1.5s delay per message
    });
  }, 1000); // Initial delay

  // After loading finishes:
  setTimeout(() => {
    // 1️⃣ Send AUDIO FIRST (standalone, no caption)
    bot.sendAudio(chatId, audioFilePath)
      .then(() => {
        // 2️⃣ Then send THUMBNAIL + ORIGINAL WELCOME MESSAGE (as caption)
        return bot.sendPhoto(chatId, thumbnailUrl, {
          caption: `✨ *Welcome to 𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊!* ✨\n\n` +
                   `Type /menu to see all commands.\n` +
                   `Type /help for available commands.\n` +
                   `Type /owner for chat with developer.\n\n` +
                   `💻 ᴄʀᴇᴀᴛᴏʀ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ ɪɴᴄ`
        });
      })
      .then(() => {
        // Delete last loading message
        if (lastMessageId) {
          bot.deleteMessage(chatId, lastMessageId).catch(() => {});
        }
      });
  }, progressMessages.length * 1500); // Wait for all loading messages

  // Final "Powered by" message (unchanged)
  setTimeout(() => {
    bot.sendMessage(chatId, "𝚖𝚢 𝚗𝚊𝚖𝚎 𝚒𝚜 ǫᴜᴇᴇɴ ʀᴜᴠᴀ ᴀɪ ");
  }, (progressMessages.length + 1) * 1500);
}
break;
case "owner": {
  try {
    const thumbnailUrl = "https://files.catbox.moe/olk0k5.jpg";
    
    await bot.sendPhoto(
      chatId,
      thumbnailUrl,
      {
        caption: `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊* 👑\n\n` +
                 `Sophisticated Telegram AI Assistant\n\n` +
                 `⚙️ Developed by *Iconic Tech*`,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "🌐 Official Channel",
              callback_data: "owner_channel"
            }],
            [{
              text: "📩 Contact Developer",
              callback_data: "owner_contact"
            }],
            [{
              text: "📜 Bot Commands",
              callback_data: "owner_commands"
            }]
          ]
        }
      }
    );

    // Store sent messages to prevent duplicates
    const sentMessages = new Set();

    // Callback handler
    bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const messageKey = `${chatId}_${callbackQuery.data}`;
      
      // Prevent duplicate handling
      if (sentMessages.has(messageKey)) {
        await bot.answerCallbackQuery(callbackQuery.id);
        return;
      }
      
      sentMessages.add(messageKey);

      switch(callbackQuery.data) {
        case "owner_channel":
          await bot.answerCallbackQuery(callbackQuery.id);
          await bot.sendMessage(
            chatId,
            `📢 *Official Channel*\n\n` +
            `Join our community for updates:\n` +
            `👉 [official chatroom](https://t.me/iconictech_official)\n\n` +
            `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
            {
              parse_mode: "Markdown",
              disable_web_page_preview: true
            }
          );
          break;

        case "owner_contact":
          await bot.answerCallbackQuery(callbackQuery.id);
          await bot.sendMessage(
            chatId,
            `👨‍💻 *Developer Contact*\n\n` +
            `For direct inquiries:\n` +
            `👉 [Iconic Tech Official](https://t.me/iconictechofficial)\n\n` +
            `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
            {
              parse_mode: "Markdown",
              disable_web_page_preview: true
            }
          );
          break;

        case "owner_commands":
          await bot.answerCallbackQuery(callbackQuery.id);
          await bot.sendMessage(
            chatId,
            `🤖 *Available Commands*\n\n` +
            `/start - Activate bot\n` +
            `/menu - All features\n` +
            `/contact - Support options\n` +
            `/skill - Technical capabilities\n` +
            `/website - Our digital platforms\n\n` +
            `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
            {
              parse_mode: "Markdown",
              reply_markup: {
                inline_keyboard: [
                  [{
                    text: "🌍 Visit Website",
                    url: "https://kineboii.github.io/Queen-ruva-official-web/"
                  }]
                ]
              }
            }
          );
          break;
      }
      
      // Clean up after 10 seconds
      setTimeout(() => sentMessages.delete(messageKey), 10000);
    });

  } catch (error) {
    console.error("Owner command error:", error);
    await bot.sendMessage(
      chatId,
      `❌ System temporarily unavailable\n` +
      `Please try again later\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
case "contact": {
  try {
    await bot.sendMessage(
      chatId,
      `📇 *Contact Options*\n\n` +
      `Choose how you'd like to connect:\n\n` +
      `👨‍💻 For technical inquiries\n` +
      `🤖 For bot support\n` +
      `💼 For business opportunities`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "📞 WhatsApp",
              url: "https://wa.me/263783525824"
            }, {
              text: "📩 Telegram",
              url: "https://t.me/iconictechofficial"
            }],
            [{
              text: "🌐 Official Channel",
              url: "https://t.me/iconictechofficial"
            }]
          ]
        }
      }
    );

  } catch (error) {
    console.error("Contact command error:", error);
    await bot.sendMessage(
      chatId,
      `❌ Couldn't load contact options\n` +
      `Please message +263 78 352 5824 directly\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
  case "githubuser":
  {
    let args = msg.text.split(" ").slice(1); // Extract arguments
    if (!args.length) {
      return bot.sendMessage(chatId, `❓ Please provide a GitHub username.\nExample:\n/githubuser iconic05`);
    }

    let username = args[0];
    let apiUrl = `https://api.github.com/users/${username}`;

    bot.sendMessage(chatId, `🔍 Fetching GitHub profile for *${username}*...`, { parse_mode: "Markdown" });

    fetch(apiUrl)
      .then((res) => res.json()) // Convert response to JSON
      .then((data) => {
        if (data.message && data.message === "Not Found") {
          return bot.sendMessage(chatId, `🚫 User '${username}' not found on GitHub.`);
        }

        let userInfo = `👤 *GitHub Profile of ${username}:*\n\n` +
          `🔹 **Followers:** ${data.followers}\n` +
          `🔹 **Following:** ${data.following}\n` +
          `🔹 **Public Repositories:** ${data.public_repos}\n` +
          `🔹 **Profile Link:** [${data.html_url}](${data.html_url})\n\n` +
          `📜 **Bio:** ${data.bio ? data.bio : "No bio available"}\n`;

        bot.sendMessage(chatId, userInfo, { parse_mode: "Markdown" });
      })
      .catch((error) => {
        bot.sendMessage(chatId, `⚠️ Error fetching user profile: ${error.message}`);
      });
  }
  break;
  case "gitclone":
  {
    let args = msg.text.split(" ").slice(1); // Extract arguments

    if (!args[0]) {
      return bot.sendMessage(chatId, `Where is the link?\nExample:\n/gitclone https://github.com/iconic05/Queen-ruva-ai-beta`);
    }

    if (!args[0].startsWith("https://github.com/")) {
      return bot.sendMessage(chatId, `🚫 Invalid GitHub link!`);
    }

    let regex1 = /(?:https|git)(?::\/\/|@)github\.com[\/:]([^\/:]+)\/(.+)/i;
    let [, user, repo] = args[0].match(regex1) || [];

    if (!user || !repo) {
      return bot.sendMessage(chatId, `🚫 Error extracting repository details.`);
    }

    repo = repo.replace(/.git$/, ""); // Remove .git if present
    let zipUrl = `https://api.github.com/repos/${user}/${repo}/zipball`;

    bot.sendMessage(chatId, `📦 Fetching ZIP file for *${repo}*...`, { parse_mode: "Markdown" });

    fetch(zipUrl, { method: "HEAD" })
      .then((res) => {
        let filename = res.headers.get("content-disposition")?.match(/attachment; filename=(.*)/)?.[1] || `${repo}.zip`;

        bot.sendDocument(chatId, zipUrl, {
          caption: `Here is the ZIP file for *${repo}*`,
          filename: filename,
        }).catch((err) => bot.sendMessage(chatId, `⚠️ Error sending ZIP: ${err.message}`));
      })
      .catch((error) => {
        bot.sendMessage(chatId, `⚠️ Error fetching ZIP file: ${error.message}`);
      });
  }
  break;
  //GAMES
  case "rps":
  {
    const choices = ["✊ Rock (like your ex's heart)", "✋ Paper (like your printer at 3AM)", "✌️ Scissors (that couldn't cut my style)"];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];
    
    bot.sendMessage(chatId, 
`🎮 *EXTREME ROCK-PAPER-SCISSORS SHOWDOWN* 🎮
⚡ *Bot Edition 3000* ⚡

I've already chosen my weapon of mass distraction! 
Can you handle the truth?

Your options (choose wisely, mortal):
/rock - ✊ Rock (for basic people)
/paper - ✋ Paper (for origami enthusiasts)
/scissors - ✌️ Scissors (for rebels without a cause)

Warning: 73% of players lose to me. 
87% of statistics are made up on the spot.
100% of you are about to have fun!`);
  }
  break;
  case "flip":
  {
    const result = Math.random() > 0.5 ? "HEADS (crown up!) 👑" : "TAILS (just like your luck) 😈";
    bot.sendMessage(chatId, 
`💰 *QUEEN RUVA’S ROYAL COIN FLIP* 💰  
I flipped… *${result}*  

Bet again?  
🔸 /flip – Try your luck, peasant.`);
  }
  break;
  case "dice":
  {
    const roll = Math.floor(Math.random() * 6) + 1;
    let comment = "";
    if (roll === 1) comment = "Oof. Even my bot feels bad for you. 😬";
    else if (roll === 6) comment = "A WINNER IS YOU! (For once.) 🎉";
    else comment = "Mid. Just like your life choices. 😐";
    
    bot.sendMessage(chatId, 
`🎲 *QUEEN RUVA’S DICE OF DESTINY* 🎁  
You rolled… *${roll}*!  
${comment}  

🔸 /dice – Roll again, if you dare.`);
  }
  break;
  case "guess":
  {
    const secretNum = Math.floor(Math.random() * 10) + 1;
    bot.sendMessage(chatId, 
`🔢 *GUESS THE NUMBER (OR LOSE MY RESPECT)* 🔢  
I’m thinking of a number (1-10).  

🔸 /guess1 to /guess10 – Take a shot, peasant.  

*Hint:* It’s not your IQ. 😏`);
  }
  break;
  case "tod":
  {
    const options = ["TRUTH: What’s your most embarrassing childhood memory? 😳", "DARE: Send a voice note singing ‘Baby Shark’ in a royal accent. 🎤🦈"];
    const randomPick = options[Math.floor(Math.random() * options.length)];
    bot.sendMessage(chatId, 
`👀 *TRUTH OR DARE (NO CHICKENING OUT)* 👀  
${randomPick}  

🔸 /tod – I’ll go easier on you next time. (Lie.)`);
  }
  break;
  case "8ball":
  {
    const responses = [
      "👑 As I predicted: YES. (Now bow.)",  
      "🙅‍♀️ Absolutely not. (Try again in 5 business years.)",  
      "🤡 Maybe, if clowns ran the world. (Oh wait…)",  
      "💀 My sources say *you don’t wanna know.*"
    ];
    const answer = responses[Math.floor(Math.random() * responses.length)];
    bot.sendMessage(chatId, 
`🎱 *QUEEN RUVA’S ROYAL 8-BALL* 🎱  
You shake the orb…  

*${answer}*  

🔸 /8ball – Ask another foolish question.`);
  }
  break;
  case "ttt":
  {
    bot.sendMessage(chatId, 
`❌⭕ *TIC-TAC-TOE (PREPARE FOR HUMILIATION)* ❌⭕  
I’ll be X’s. You’ll be O’s. (Like your reaction when you lose.)  

🔸 /ttt1 to /ttt9 – Pick a square, peasant.  

*Note:* I’ve never lost. (I delete the evidence.)`);
  }
  break;
  case "hangman":
  {
    const words = ["CROWN", "ROYALTY", "SERVANT", "OBEY"];
    const secretWord = words[Math.floor(Math.random() * words.length)];
    bot.sendMessage(chatId, 
`💀 *HANGMAN (BUT MAKE IT ROYAL)* 💀  
_ _ _ _ _  

Guess a letter or DIE (not really… unless?).  

🔸 /hangmanA to /hangmanZ – Take a guess!`);
  }
  break;
  case "roulette":
  {
    const chambers = ["🔫 *CLICK* (You live… for now.)", "🔫💥 *BANG* (RIP.)"];
    const shot = chambers[Math.floor(Math.random() * chambers.length)];
    bot.sendMessage(chatId, 
`😈 *QUEEN RUVA’S EMOJI ROULETTE* 😈  
You spin the chamber… pull the trigger…  

${shot}  

🔸 /roulette – Play again? (I’d advise against it.)`);
  }
  break;
  case "dadjoke":
  {
    const jokes = [
      "Why did the scarecrow win an award? 🌾 Because he was OUTSTANDING in his field!",  
      "I told my dog he’s a good boy. 🐕 He said, *‘Woof.’* Deep stuff.",  
      "What’s brown and sticky? 🪵 A stick. (I’m not sorry.)"
    ];
    const joke = jokes[Math.floor(Math.random() * jokes.length)];
    bot.sendMessage(chatId, 
`😑 *DAD JOKES (WHY DID YOU ASK FOR THIS?)* 😑  
${joke}  

🔸 /dadjoke – Pun-ish yourself again.`);
  }
  break;
  case "nhie":
  {
    const prompts = [
      "🍷 Never have I ever… pretended to work while actually napping.",  
      "🍷 Never have I ever… cried over a meme.",  
      "🍷 Never have I ever… lied about my height. (Guilty.)"
    ];
    const prompt = prompts[Math.floor(Math.random() * prompts.length)];
    bot.sendMessage(chatId, 
`🚨 *NEVER HAVE I EVER (SPILL THE TEA)* 🚨  
${prompt}  

🔸 /nhie – Another round? (I know your secrets.)`);
  }
  break;
  case "riddle":
  {
    const riddles = [
      "🧠 What has keys but can’t open locks? (A piano. Duh.)",  
      "🧠 The more you take, the more you leave behind. What am I? (Footsteps. Try harder.)",  
      "🧠 I’m not alive, but I can grow. What am I? (A shadow. Basic.)"
    ];
    const riddle = riddles[Math.floor(Math.random() * riddles.length)];
    bot.sendMessage(chatId, 
`🤯 *QUEEN RUVA’S RIDDLES (YOU’LL FAIL)* 🤯  
${riddle}  

🔸 /riddle – Attempt another. (Good luck.)`);
  }
  break;
  case "roast":
  {
    const roasts = [
      "🔥 Your face is like a cloud… whenever it appears, people hope it goes away.",  
      "🔥 If laughter is the best medicine, your face must be curing the world.",  
      "🔥 You’re not stupid; you just have bad luck thinking."
    ];
    const roast = roasts[Math.floor(Math.random() * roasts.length)];
    bot.sendMessage(chatId, 
`👊 *ROAST BATTLE (YOU’LL LOSE)* 👊  
${roast}  

🔸 /roast – Try again. (I have unlimited ammo.)`);
  }
  break;
  bot.sendMessage(chatId, 
`👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊’S GAME PALACE* 👑  
Choose your fate:  

🎮 /rps – Rock-Paper-Scissors  
🪙 /flip – Coin Flip  
🎲 /dice – Roll Dice  
🔢 /guess – Guess the Number  
🤔 /wyr – Would You Rather  
👀 /tod – Truth or Dare  
🎱 /8ball – Magic 8-Ball  
❌ /ttt – Tic-Tac-Toe  
💀 /hangman – Hangman  
😈 /roulette – Russian Roulette  
✨ /fortune – Fortune Teller  
😑 /dadjoke – Dad Jokes  
🍷 /nhie – Never Have I Ever  
🤯 /riddle – Riddles  
👊 /roast – Roast Battle  

*𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊* 👑💅`);
  case "searchrepo":
  {
    let args = msg.text.split(" ").slice(1); // Extract arguments
    if (!args.length) {
      return bot.sendMessage(chatId, `❓ Please provide a search term.\nExample:\n/searchrepo Queen-ruva-ai-beta`);
    }

    let query = encodeURIComponent(args.join(" ")); // Format search term
    let apiUrl = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=5`;

    bot.sendMessage(chatId, `🔍 Searching GitHub for *${args.join(" ")}*...`, { parse_mode: "Markdown" });

    fetch(apiUrl)
      .then((res) => res.json()) // Convert response to JSON
      .then((data) => {
        if (!data.items || data.items.length === 0) {
          return bot.sendMessage(chatId, "❌ No repositories found.");
        }

        let repoList = `🔎 *Top 5 GitHub Repositories for '${args.join(" ")}'*:\n\n`;
        data.items.forEach((repo, index) => {
          repoList += `🔹 *${index + 1}. [${repo.full_name}](${repo.html_url})*\n` +
                      `   ⭐ Stars: ${repo.stargazers_count} | 🔄 Forks: ${repo.forks_count}\n` +
                      `   📜 Description: ${repo.description ? repo.description : "No description"}\n\n`;
        });

        bot.sendMessage(chatId, repoList, { parse_mode: "Markdown", disable_web_page_preview: true });
      })
      .catch((error) => {
        bot.sendMessage(chatId, `⚠️ Error fetching repositories: ${error.message}`);
      });
  }
  break;
  const botName = "𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 Developer Iconic Tech";
const developerName = "Iconic Tech";

// Handle the "/delete" command
bot.on('message', (msg) => {
  const chatId = msg.chat.id;

  if (msg.text.toLowerCase() === "/delete") {
    // Send the inline keyboard with delete options
    bot.sendMessage(chatId, `Choose an option: - ${botName} | Developer: ${developerName}`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Delete this message", callback_data: "delete_message" },
            { text: "Delete all messages", callback_data: "delete_all" }
          ]
        ]
      }
    });
  }
});

// Handle callback queries from the inline keyboard
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;

  if (callbackQuery.data === "delete_message") {
    if (callbackQuery.message.reply_to_message) {
      const messageId = callbackQuery.message.reply_to_message.message_id;

      // First, delete the replied message
      bot.deleteMessage(chatId, messageId).then(() => {
        bot.sendMessage(chatId, `✅ The message has been deleted. - ${botName} | Developer: ${developerName}`);
      }).catch(err => {
        bot.sendMessage(chatId, `❌ Failed to delete the message. ${err.message} - ${botName} | Developer: ${developerName}`);
      });

      // Optionally, delete the bot's own message with the button (clean interface)
      bot.deleteMessage(chatId, callbackQuery.message.message_id);
    } else {
      bot.sendMessage(chatId, `❓ Please reply to a message to delete it. - ${botName} | Developer: ${developerName}`);
    }
  }

  if (callbackQuery.data === "delete_all") {
    // Handle deleting all messages in the chat (ensure the bot has the required permissions)
    bot.getChatMessages(chatId).then(messages => {
      messages.forEach(message => {
        bot.deleteMessage(chatId, message.message_id).catch(err => console.error("Failed to delete message:", err));
      });
      bot.sendMessage(chatId, `✅ All messages have been deleted. - ${botName} | Developer: ${developerName}`);
    }).catch(err => {
      bot.sendMessage(chatId, `❌ Failed to delete all messages. ${err.message} - ${botName} | Developer: ${developerName}`);
    });
  }

  // Acknowledge the callback query
  bot.answerCallbackQuery(callbackQuery.id);
});
  case "social":
  {
    let args = msg.text.split(" ").slice(1); // Extract username
    if (!args.length) {
      return bot.sendMessage(chatId, `❓ Please provide a username.\nExample:\n/social iconic05`);
    }

    let username = args[0];
    
    // Links to social media profiles
    let profiles = {
      github: `https://github.com/${username}`,
      twitter: `https://twitter.com/${username}`,
      linkedin: `https://www.linkedin.com/in/${username}`,
      facebook: `https://www.facebook.com/${username}`,
      instagram: `https://www.instagram.com/${username}`,
    };

    // Construct response message
    let socialLinks = `🔗 **Social Media Profiles for ${username}:**\n\n` +
      `- GitHub: [${username} on GitHub](${profiles.github})\n` +
      `- Twitter: [${username} on Twitter](${profiles.twitter})\n` +
      `- LinkedIn: [${username} on LinkedIn](${profiles.linkedin})\n` +
      `- Facebook: [${username} on Facebook](${profiles.facebook})\n` +
      `- Instagram: [${username} on Instagram](${profiles.instagram})`;

    bot.sendMessage(chatId, socialLinks, { parse_mode: "Markdown" });
  }
  break;
  case "checkmail": {
  let args = msg.text.split(" ").slice(1); // Extract email argument
  if (!args.length) {
    return bot.sendMessage(chatId, `❓ Please provide an email address.\nExample:\n/checkmail example@gmail.com`);
  }

  const email = args[0];
  const emailRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/; // Regex to validate email format

  if (!emailRegex.test(email)) {
    return bot.sendMessage(chatId, `🚫 The email address ${email} is invalid.`);
  }

  // Simulate a check (for example, checking domain availability or if email is blacklisted)
  const domain = email.split("@")[1]; // Get the domain part of the email
  const mockBlacklistedDomains = ["example.com", "spam.com"]; // Mock blacklisted domains

  if (mockBlacklistedDomains.includes(domain)) {
    return bot.sendMessage(chatId, `🚫 The email domain ${domain} is blacklisted.`);
  }

  // If everything passes, send confirmation
  bot.sendMessage(chatId, `✅ The email address ${email} is valid and not blacklisted.`);
} break;
  
  case "genpassword":
  {
    const generatePassword = (length = 12) => {
      const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+=<>?";
      let password = "";
      for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * charset.length);
        password += charset[randomIndex];
      }
      return password;
    };

    let password = generatePassword();
    bot.sendMessage(chatId, `🔑 Here is a strong password: ${password}`);
  }
  break;
  case "tempemail":
  {
    function generateRandomString(length) {
      return Math.random().toString(36).substring(2, 2 + length);
    }

    const tempEmail = `${generateRandomString(8)}@gmail.com`; // Generate an 8-character email prefix
    const tempPassword = generateRandomString(12); // Generate a 12-character password

    bot.sendMessage(chatId, `📧 *Your Temporary Email Address:* \`${tempEmail}\`\n🔑 *Password:* \`${tempPassword}\``);
  }
  break;
  case "reverse":
  {
    // Extract the text after the command
    let textToReverse = msg.text.split(" ").slice(1).join(" ");

    if (!textToReverse) {
      return bot.sendMessage(chatId, `❓ Please provide some text to reverse.\nExample:\n/reverse Hello World`);
    }

    // Reverse the text
    let reversedText = textToReverse.split("").reverse().join("");

    // Send the reversed text back to the user
    bot.sendMessage(chatId, `🔄 Reversed Text:\n\n${reversedText}`);
  }
  break;
  case "repo":
  {
    const repos = [
      {
        owner: "iconic05",
        name: "Queen-ruva-ai-beta"
      },
      {
        owner: "iconic05",
        name: "Joker-Max-XMD"
      }
    ];

    const fetchPromises = repos.map(repo => {
      const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}`;
      return fetch(apiUrl)
        .then(res => res.json())
        .then(data => {
          if (data.message && data.message.includes("Not Found")) {
            return `🚫 Repository ${repo.name} not found.`;
          }
          
          return `🌟 *${data.name} Repository Info* 🌟\n\n` +
            `🆔 **Repo ID:** ${data.id}\n` +
            `👤 **Owner:** [${data.owner.login}](${data.owner.html_url})\n` +
            `📂 **Repo Name:** [${data.full_name}](${data.html_url})\n` +
            `📅 **Created At:** ${new Date(data.created_at).toLocaleString()}\n` +
            `🔄 **Last Updated:** ${new Date(data.updated_at).toLocaleString()}\n` +
            `🔀 **Forks:** ${data.forks_count}\n` +
            `👀 **Watchers:** ${data.watchers_count}\n` +
            `⭐ **Stars:** ${data.stargazers_count}\n` +
            `📌 **Default Branch:** ${data.default_branch}\n` +
            `📋 **Open Issues:** ${data.open_issues_count}\n` +
            `⚡ **License:** ${data.license ? data.license.name : "None"}\n` +
            `📜 **Description:** ${data.description ? data.description : "No description available"}\n\n` +
            `🔗 **Repo Link:** [Click Here](${data.html_url})`;
        })
        .catch(error => {
          return `⚠️ Error fetching ${repo.name} data: ${error.message}`;
        });
    });

    Promise.all(fetchPromises)
      .then(results => {
        const combinedMessage = results.join("\n\n────────────────\n\n");
        bot.sendMessage(chatId, combinedMessage, { parse_mode: "Markdown" });
      })
      .catch(error => {
        bot.sendMessage(chatId, `⚠️ Error processing repository data: ${error.message}`);
      });
  }
  break;
  case "file":
  {
    const repos = [
      {
        owner: "iconic05",
        name: "Queen-ruva-ai-beta"
      },
      {
        owner: "iconic05",
        name: "Joker-Max-XMD"
      }
    ];

    repos.forEach(async (repo, index) => {
      // Delay each message by 1.5 seconds
      setTimeout(async () => {
        const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.name}`;

        try {
          const response = await fetch(apiUrl);
          const data = await response.json();

          if (data.message && data.message.includes("Not Found")) {
            return bot.sendMessage(chatId, `❌ Repository ${repo.name} not found.`);
          }

          const fileName = `${repo.name}.zip`;
          const zipUrl = `https://github.com/${repo.owner}/${repo.name}/archive/refs/heads/main.zip`;

          const message =
            `🗃 *${data.name} File Available*\n\n` +
            `📄 *Description:* ${data.description || "No description."}\n` +
            `⭐ *Stars:* ${data.stargazers_count}   |   🍴 *Forks:* ${data.forks_count}\n\n` +
            `📦 *Download:* [${fileName}](${zipUrl})\n\n` +
            `⚡ _Powered by @iconic_`;

          await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        } catch (err) {
          bot.sendMessage(chatId, `⚠️ Error fetching ${repo.name}: ${err.message}`);
        }
      }, index * 1500); // 1.5 sec delay per repo
    });
  }
  break;
  case "time":
  {
    let currentDate = new Date();
    let hours = currentDate.getHours();
    let minutes = currentDate.getMinutes();
    let seconds = currentDate.getSeconds();

    // Format time to be more readable
    minutes = minutes < 10 ? '0' + minutes : minutes;
    seconds = seconds < 10 ? '0' + seconds : seconds;

    let formattedTime = `${hours}:${minutes}:${seconds}`;

    // Get the day and date
    let day = currentDate.toLocaleDateString('en-US', { weekday: 'long' });
    let date = currentDate.toLocaleDateString();

    // Send message with the updated time
    bot.sendMessage(chatId, `
🌟 *Current Time* 🌟
====================

⏰ *Time:* ${formattedTime}  
📅 *Day:* ${day}  
🗓️ *Date:* ${date}

====================
Powered by ICONICS-TECH
`, { parse_mode: 'Markdown' });
  }
  break;
  case "learn_coding":
  {
    bot.sendMessage(chatId, `
❏━『 𝗟𝗘𝗔𝗥𝗡 𝗖𝗢𝗗𝗜𝗡𝗚 』━❏
📚 Want to start coding? Here are some resources:

🔹 **Python** - [Learn Here](https://www.w3schools.com/python/)
🔹 **JavaScript** - [Learn Here](https://www.w3schools.com/js/)
🔹 **HTML & CSS** - [Learn Here](https://www.w3schools.com/html/)
🔹 **FreeCodeCamp** - [Visit](https://www.freecodecamp.org/)

🚀 Start your journey today!
    `, { parse_mode: "Markdown", disable_web_page_preview: true });
  }
  break;

case "channel":
  {
    const thumbnailUrl = "https://files.catbox.moe/olk0k5.jpg";  // Your thumbnail URL for "channel" case
    const userName = msg.from.username || 'No username';  // Get the user's username (if available)
    const userId = msg.from.id;  // Get the user's ID

    bot.sendPhoto(chatId, thumbnailUrl, {
      caption: `
 ❏━𝗤𝗨𝗘𝗘𝗡 𝗥𝗨𝗩𝗔 𝗔𝗜 𝗕𝗘𝗧𝗔━❏
┏━━━━━━━━━━━━━━━━━━━━┓
┃⚇ Nᴀᴍᴇ : ${userName}
┃⚇ Uѕ𝗲𝗿 𝗜𝗗 : ${userId}
┃⚇ Dᴇᴠᴇʟᴏᴘᴇʀ : 𝗜𝗖𝗢𝗡𝗜𝗖 𝗧𝗘𝗖𝗛
┗━━━━━━━━━━━━━━━━━━━━┛

━━━━〣 𝗡𝗢𝗧𝗜𝗙𝗜𝗖𝗔𝗧𝗜𝗢𝗡 〣━━━━┓
┃         〢𝗝𝗼𝗶𝗻 𝗢𝘂𝗿 𝗖𝗵𝗮𝗻𝗻𝗲𝗹〢
┃https://whatsapp.com/channel/0029ValX2Js9RZAVtDgMYj0r
┃
┃
┗━━━━━━━━━━━━━━━━━━━━━━┛
𝗣𝗼𝘄𝗲𝗿𝗲𝗱 𝗯𝘆 𝗜𝗖𝗢𝗡𝗜𝗖 𝗧𝗘𝗖𝗛
      `
    });
  }
  break;
  case "invite": {
    const thumbnailUrl = "https://files.catbox.moe/olk0k5.jpg";  // Thumbnail URL for "channel" case
    const userName = msg.from.username || 'No username';  // Get the user's username (if available)
    const userId = msg.from.id;  // Get the user's ID

    const caption = `
❏━𝗤𝗨𝗘𝗘𝗡 𝗥𝗨𝗩𝗔 𝗔𝗜 𝗕𝗘𝗧𝗔━❏
┏━━━━━━━━━━━━━━━━━━━━┓
┃⚇ Nᴀᴍᴇ : ${userName}
┃⚇ Uѕ𝗲𝗿 𝗜𝗗 : ${userId}
┃⚇ Dᴇᴠᴇʟᴏᴘᴇʀ : 𝗜𝗖𝗢𝗡𝗜𝗖 𝗧𝗘𝗖𝗛
┗━━━━━━━━━━━━━━━━━━━━┛

━━━━〣 𝗡𝗢𝗧𝗜𝗙𝗜𝗖𝗔𝗧𝗜𝗢𝗡 〣━━━━┓
┃ Hello user! Share this bot with others to assist them:
┃ https://t.me/Iconictechogtechbot
┗━━━━━━━━━━━━━━━━━━━━━━┛
𝗣𝗼𝘄𝗲𝗿𝗲𝗱 𝗯𝘆 𝗜𝗖𝗢𝗡𝗜𝗖 𝗧𝗘𝗖𝗛
    `;

    bot.sendPhoto(chatId, thumbnailUrl, { caption });
}
break;
  case "bot_hosting":
  {
    const userId = msg.from.id;  // User's ID
    const botId = bot.id;        // Bot's ID
    const currentDate = new Date().toLocaleString();  // Current date

    bot.sendMessage(chatId, `
❏━『 𝗕𝗢𝗧 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 』━❏
🚀 Want to host your bot or website? Here is the option:

💻 **Premium Panel** - Contact for Premium: +263 78 352 5824  
🔹 **Panel** - [BOT HOSTING](https://bot-hosting.net/?aff=1336281489364484136)

**type**  | /youtube | for tutorial 

📅 **Date**: ${currentDate}  
👤 **User ID**: ${userId}  
🤖 **Bot ID**: ${botId}

🌍  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ

Sign up here: [Sign Up Link](https://bot-hosting-dev.netlify.app/)
    `, { parse_mode: "Markdown", disable_web_page_preview: true });
  }
  break;
  case "broadcast": {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userName = msg.from.first_name || "Unknown User";
    const botName = "𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊"; // Updated bot name
    const botDev = "Iconic Tech"; // Your name as the bot developer

    // Extract the broadcast message
    const broadcastMessage = msg.text.split(" ").slice(1).join(" ").trim();

    if (!broadcastMessage) {
        bot.sendMessage(chatId, "⚠️ *Usage:* `/broadcast Your Message Here`\n\nExample:\n`/broadcast Hello guys!`", { parse_mode: "Markdown" });
        return;
    }

    try {
        // Create the final message format (this will be sent to groups)
        const finalMessage = `📢 *Broadcast Message*\n\n💬 *Message:* ${broadcastMessage}\n👤 *Sent by:* ${userName}\n🤖 *Bot Name:* ${botName}\n👨‍💻 *Bot Developer:* ${botDev}`;

        // Show the preview to the user (this is the preview message in the current chat)
        bot.sendMessage(chatId, `✅ *Preview of Broadcast Message:*\n\n${finalMessage}`, { parse_mode: "Markdown" });

        // List of group chat IDs (add your group IDs here)
        const groupChatIds = [
            -1001234567890,  // Example group 1
            -1009876543210,  // Example group 2
            -1001122334455,  // Example group 3
            -1005566778899,  // Example group 4
            -1009988776655   // Example group 5
        ];

        // Send the message to each group
        groupChatIds.forEach(groupId => {
            bot.sendMessage(groupId, finalMessage, { parse_mode: "Markdown" });
        });

        // Send the confirmation that the broadcast was sent to the groups
        bot.sendMessage(chatId, "✅ *Broadcast sent successfully to the groups!*", { parse_mode: "Markdown" });

    } catch (error) {
        console.error("Broadcast Error:", error);
        bot.sendMessage(chatId, "⚠️ Failed to send the broadcast. Please try again later.");
    }
    break;
}
  case "premium_apps":
  {
    bot.sendMessage(chatId, `
❏━『 𝗣𝗥𝗘𝗠𝗜𝗨𝗠 𝗔𝗣𝗣𝗦 』━❏
🚀 Explore our Premium Apps:

🔹 **Premium Apps Website** - [Visit Here](https://woftech.vercel.app/)

📅 **Date**: ${new Date().toLocaleString()}
👤 **User ID**: ${msg.from.id}

 ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ
    `, { parse_mode: "Markdown", disable_web_page_preview: true });
  }
  break;
  case "setting":
  {
    const thumbnailUrl = "https://files.catbox.moe/olk0k5.jpg"; // Thumbnail URL
    const userName = msg.from.username || 'No username'; // Get the username
    const userId = msg.from.id; // Get the user's ID
    const currentDate = new Date().toLocaleDateString(); // Get the current date

    bot.sendPhoto(chatId, thumbnailUrl, {
      caption: `
 ❏━『 𝗦𝗘𝗧𝗧𝗜𝗡𝗚𝗦 』━❏
┏━━━━━━━━━━━━━━━━━━━━┓
┃ 🆔 Uѕ𝗲𝗿 𝗜𝗗 : ${userId}
┃ 🛠️ 𝗦𝘁𝗮𝘁𝘂𝘀 : 𝗔𝗰𝘁𝗶𝘃𝗲 ✅
┃ 📅 Dᴀ𝘁ᴇ : ${currentDate}
┗━━━━━━━━━━━━━━━━━━━━┛

🎯 𝗙𝗘𝗔𝗧𝗨𝗥𝗘𝗦 🎯
┣ /Learn_coding  
┣ /Unbanned_Whatsapp  
┣ /Bot_Hosting  
┣ /Premium_apps  
┗ /Queen_ruva_ai_deploy  

🔔 𝗝𝗼𝗶𝗻 𝗢𝘂𝗿 𝗖𝗵𝗮𝗻𝗻𝗲𝗹  
📌 [𝗖𝗹𝗶𝗰𝗸 𝗛𝗲𝗿𝗲](https://whatsapp.com/channel/0029ValX2Js9RZAVtDgMYj0r)  

🚀 𝗣𝗼𝘄𝗲𝗿𝗲𝗱 𝗕𝘆 𝗜𝗖𝗢𝗡𝗜𝗖 𝗧𝗘𝗖𝗛  
      `
    });
  }
  break;
  case "unbanned_whatsapp":
  {
    bot.sendMessage(chatId, `
❏━『 𝗨𝗡𝗕𝗔𝗡𝗡𝗘𝗗 𝗪𝗛𝗔𝗧𝗦𝗔𝗣𝗣 』━❏
🚀 Need help unbanning WhatsApp or have any questions? Visit our website:

🔹 **Website** - [not link added](https://yourwebsite.com)

📅 **Date**: ${new Date().toLocaleString()}
👤 **User ID**: ${msg.from.id}

Powered by **Joshua Mambo**  
Special thanks to **ICONIC TECH** for the support
    `, { parse_mode: "Markdown", disable_web_page_preview: true });
  }
  break;
  case "queen_ruva_ai_deploy":
  {
    bot.sendMessage(chatId, `
❏━『 𝗤𝗨𝗘𝗘𝗡 𝗥𝗨𝗩𝗔 𝗔𝗜 𝗗𝗘𝗣𝗟𝗢𝗬 』━❏
🚀 Want to deploy Queen Ruva AI? Click the link below to access the official GitHub repository:

🔹 **GitHub Repo**: https://github.com/iconic05/Queen-ruva-ai-beta

💻 Follow the instructions in the repository to deploy and start using Queen Ruva AI.

🌍 Get your Queen Ruva AI instance live today!
    `);
  }
  break;
  case "youtube":
  {
    const thumbnailUrl = "https://files.catbox.moe/o7genh.jpg";  // Your updated thumbnail URL
    const userName = msg.from.username || 'No username';  // Get the user's username (if available)
    const userId = msg.from.id;  // Get the user's ID

    bot.sendPhoto(chatId, thumbnailUrl, {
      caption: `
 ❏━𝗤𝗨𝗘𝗘𝗡 𝗥𝗨𝗩𝗔 𝗔𝗜 𝗕𝗘𝗧𝗔━❏
┏━━━━━━━━━━━━━━━━━━━━┓
┃⚇ Nᴀᴍᴇ : ${userName}
┃⚇ Uѕ𝗲𝗿 𝗜𝗗 : ${userId}
┃⚇ Dᴇᴠᴇ𝗹ᴏ𝗽ᴇ𝗿 : 𝗜𝗖𝗢𝗡𝗜𝗖 𝗧𝗘𝗖𝗛
┗━━━━━━━━━━━━━━━━━━━━┛

━━━━〣 𝗡𝗢𝗧𝗜𝗙𝗜𝗖𝗔𝗧𝗜𝗢𝗡 〣━━━━┓
┃         〢𝗝𝗼𝗶𝗻 𝗢𝘂𝗿 𝗖𝗵𝗮𝗻𝗻𝗲𝗹〢
┃https://whatsapp.com/channel/0029ValX2Js9RZAVtDgMYj0r
┃
┃         〢𝗛𝗼𝘄 𝘁𝗼 𝗗𝗲𝗽𝗹𝗼𝘆 𝗤𝘂𝗲𝗲𝗻 𝗥𝘂𝘃𝗮 𝗔𝗜 𝗕𝗘𝗧𝗔〢
┃https://youtu.be/4MWV8qQqJd0?si=3fy5qFXQxr8AjIJL
┃
┃         〢𝗣𝗮𝗻𝗲𝗹 𝗩𝗶𝗲𝘄 〢
┃https://youtu.be/Pzl43dlPkQw?si=t3zMgaUNkH-UIg8y
┃
┃         〢𝗕𝗼𝘁 𝗥𝗲𝗽𝗼 𝗙𝗼𝗿𝗸 𝗕𝗲𝗳𝗼𝗿𝗲 𝗗𝗼𝘄𝗻𝗹𝗼𝗮𝗱〢
┃https://github.com/iconic05/Queen-ruva-ai-beta
┗━━━━━━━━━━━━━━━━━━━━━━┛
𝗣𝗼𝘄𝗲𝗿𝗲𝗱 𝗯𝘆 𝗜𝗖𝗢𝗡𝗜𝗖 𝗧𝗘𝗖𝗛
      `
    });

    // Adding a delay of 5 seconds before sending the extra message
    setTimeout(() => {
      bot.sendMessage(chatId, "〢𝗗𝗼𝗻'𝘁 𝗳𝗼𝗿𝗴𝗲𝘁 𝘁𝗼 𝗦𝘂𝗯𝘀𝗰𝗿𝗶𝗯𝗲, 𝗟𝗶𝗸𝗲, 𝗮𝗻𝗱 𝗖𝗼𝗺𝗺𝗲𝗻𝘁!");
    }, 5000);  // Delay of 5000 milliseconds (5 seconds)
  }
  break;
  case "prank":
  {
    const prankMessages = [
      `🎉 *PRANK TIME!* 🎉
      Oh no! You've been pranked by 𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊! 😜
      Stay cool, it's all in good fun!
      
      🛠️ More pranks coming soon!
      
      Powered by ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,

      `😎 Gotcha! You've been hit by a prank from 𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊! 🤪
      Don’t worry, it’s all fun and games!
      
      Keep your eyes peeled for more surprises!
      
      Powered by ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,

      `🚨 Warning! 𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 just pulled a prank on you! 🤣
      You thought you were safe, but you weren't!
      
      No need to panic, it's just a prank! 😜
      
      Powered by ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`
    ];

    // Randomly select a prank message
    const randomPrank = prankMessages[Math.floor(Math.random() * prankMessages.length)];

    // Send the first message
    bot.sendMessage(chatId, randomPrank);

    // Send the prank image
    bot.sendPhoto(chatId, 'https://files.catbox.moe/du96q2.jpg');

    // Delay the next message by 2 seconds
    setTimeout(() => {
      bot.sendMessage(chatId, "🎈 Just kidding... it was all in fun! 😎");
    }, 2000);  // 2-second delay

    // Delay the next message by 5 seconds
    setTimeout(() => {
      bot.sendMessage(chatId, "😜 Stay tuned for more pranks!");
    }, 5000);  // 5-second delay
  }
  break;
  case "tts": {
  try {
    const args = msg.text.split(" ").slice(1); // Get the arguments after the command
    const text = args.join(" "); // Combine arguments into a text query

    // Check if text is provided
    if (!text) {
      return bot.sendMessage(msg.chat.id, `*Example*: /tts Hello, I am a human`, { parse_mode: "Markdown" });
    }

    // Check if text length exceeds 300 characters
    if (text.length >= 300) {
      return bot.sendMessage(msg.chat.id, "❌ The text length must be under 300 characters!");
    }

    // Notify user that the bot is processing
    await bot.sendMessage(msg.chat.id, "Processing your TTS request... ⏳");

    const id = 'id_001'; // Default TTS voice
    const response = await fetch("https://tiktok-tts.weilnet.workers.dev/api/generation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text,
        voice: id,
      }),
    });

    const data = await response.json();

    // Check if TTS audio was generated successfully
    if (!data || !data.data) {
      throw new Error("Failed to generate TTS audio");
    }

    // Convert base64 audio to a buffer
    const audioBuffer = Buffer.from(data.data, "base64");

    // Send the TTS audio as a voice message
    await bot.sendVoice(msg.chat.id, audioBuffer, {
      reply_to_message_id: msg.message_id, // Reply to the original message
    });
  } catch (error) {
    console.error("Error during /tts command:", error);
    bot.sendMessage(msg.chat.id, "❌ An error occurred while generating TTS. Please try again later.");
  }
  break;
}
case "morning":
  {
    const currentHour = new Date().getHours();

    if (currentHour >= 5 && currentHour < 12) {
      bot.sendMessage(chatId, "Good Morning! ☀️ Have a wonderful day ahead!");
    } else {
      bot.sendMessage(chatId, "It's not morning anymore. But good day anyway! 😊");
    }
  }
  break;

case "afternoon":
  {
    const currentHour = new Date().getHours();

    if (currentHour >= 12 && currentHour < 17) {
      bot.sendMessage(chatId, "Good Afternoon! 🌞 Hope you're having a great day!");
    } else {
      bot.sendMessage(chatId, "It's not afternoon anymore. But I hope you're having a great day!");
    }
  }
  break;
  case "contact": {
  try {
    // Display contact options with interactive buttons
    await bot.sendMessage(
      chatId,
      `👑 *Iconic Tech Official Contact* 👑\n\n` +
      `For inquiries about:\n\n` +
      `• Our technology stack & AI development\n` +
      `• Ruva AI Beta Telegram bot features\n` +
      `• WhatsApp bot solutions\n\n` +
      `Please choose an option below:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "💻 Technology Skills Inquiry",
              callback_data: "contact_tech"
            }],
            [{
              text: "🤖 Ruva AI Beta (Telegram)",
              callback_data: "contact_telegram"
            }],
            [{
              text: "📱 WhatsApp Bot Services",
              callback_data: "contact_whatsapp"
            }],
            [{
              text: "👨‍💻 Direct Developer Contact",
              url: "https://t.me/iconictechofficial"
            }]
          ]
        }
      }
    );

    // Handle button responses
    bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data;

      let response;
      switch(data) {
        case "contact_tech":
          response = `🛠️ *Iconic Tech Skills*\n\n` +
                     `We specialize in:\n` +
                     `- AI/NLP chatbot development\n` +
                     `- Multi-platform bot integration\n` +
                     `- Custom automation solutions\n\n` +
                     `📞 Contact: +263 78 352 5824\n` +
                     `🌐 Channel: @iconictechofficial`;
          break;
        
        case "contact_telegram":
          response = `🤖 *Ruva AI Beta (Telegram)*\n\n` +
                     `Features include:\n` +
                     `- Advanced mood analysis\n` +
                     `- Multi-language support\n` +
                     `- Custom command system\n\n` +
                     `Try it now: t.me/ruvaaibot\n` +
                     `Support: @iconictechofficial`;
          break;
        
        case "contact_whatsapp":
          response = `📱 *WhatsApp Bot Services*\n\n` +
                     `We offer:\n` +
                     `- WhatsApp Business API integration\n` +
                     `- Chatbot deployment\n` +
                     `- Bulk messaging solutions\n\n` +
                     `Direct contact: +263 78 352 5824\n` +
                     `Demo available on request`;
          break;
      }

      await bot.sendMessage(
        chatId,
        response + `\n\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        { parse_mode: "Markdown" }
      );
      
      await bot.answerCallbackQuery(callbackQuery.id);
    });

  } catch (error) {
    console.error("Contact command error:", error);
    await bot.sendMessage(
      chatId,
      `❌ Couldn't load contact options\n` +
      `Please message us directly:\n\n` +
      `📱 WhatsApp: +263 78 352 5824\n` +
      `📢 Telegram: @iconictechofficial\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
  case "topic": {
  try {
    const topics = [
      {
        name: "🤖 Tech Talk",
        description: "Discuss AI, gadgets, and future tech!",
        prompt: "What tech innovation excites you most?"
      },
      {
        name: "🎬 Movie Night",
        description: "Share favorite films and hidden gems!",
        prompt: "What movie could you watch 100 times?"
      },
      {
        name: "🌌 Space Wonders",
        description: "Explore galaxies and cosmic mysteries!",
        prompt: "If you could visit any planet, which one?"
      },
      {
        name: "🍳 Foodie Corner",
        description: "Debate best snacks and secret recipes!",
        prompt: "What weird food combo actually slaps?"
      }
    ];

    // Create interactive buttons
    const topicButtons = topics.map(topic => ({
      text: `${topic.name} - ${topic.description}`,
      callback_data: `topic_${topic.name.replace(/\s+/g, '_')}`
    }));

    // Split buttons into rows of 2
    const buttonRows = [];
    while (topicButtons.length) {
      buttonRows.push(topicButtons.splice(0, 2));
    }

    // Send topic menu
    bot.sendMessage(
      chatId,
      `🎭 *Queen Ruva's Conversation Studio* 🎭\n\n` +
      `✨ *Choose a new topic:*\n` +
      `Let's spice up this chat!`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: buttonRows
        }
      }
    );

    // Handle button presses
    bot.on('callback_query', (callbackQuery) => {
      const data = callbackQuery.data;
      if (data.startsWith('topic_')) {
        const selectedTopic = topics.find(t => 
          t.name.replace(/\s+/g, '_') === data.split('_')[1]
        );
        
        bot.sendMessage(
          callbackQuery.message.chat.id,
          `🔄 *Topic Shifted to ${selectedTopic.name}* 🔄\n\n` +
          `${selectedTopic.prompt}\n\n` +
          `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
          { parse_mode: "Markdown" }
        );
        
        bot.answerCallbackQuery(callbackQuery.id);
      }
    });

  } catch (error) {
    console.error("Topic error:", error);
    bot.sendMessage(
      chatId,
      `❌ *Royal Topic Changer Malfunction!*\n` +
      `Queen Ruva dropped her conversation cards!\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
  case "mood": {
  try {
    // Get user's text from reply or command
    const text = msg.reply_to_message?.text || msg.text.split(' ').slice(1).join(' ');
    
    if (!text) {
      return bot.sendMessage(
        chatId,
        `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 - Mood Analyzer* 👑\n\n` +
        `📝 _Usage:_ Reply to a message or type \`/mood [your text]\`\n` +
        `✨ _Example:_ \`/mood I feel amazing today!\`\n\n` +
        `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        { parse_mode: "Markdown" }
      );
    }

    // Enhanced mood database with multiple detection methods
    const moodDatabase = {
      ecstatic: {
        triggers: ["ecstatic", "overjoyed", "thrilled", "😭", "🥹"],
        emoji: "🌈",
        response: "✨ *ECSTATIC ENERGY DETECTED!*\nQueen Ruva is dazzled by your euphoria! The universe smiles with you!",
        sticker: "CAACAgQAAxkBAAEL...", // Sticker file_id for happy
        color: "#FFD700" // Gold
      },
      melancholic: {
        triggers: ["melancholic", "blue", "nostalgic", "bittersweet", "💔"],
        emoji: "🌌",
        response: "🕯️ *MELANCHOLIC WHISPERS...*\nQueen Ruva senses your wistful heart. Beautiful souls often dance with shadows.",
        sticker: "CAACAgQAAxkBAAEL...",
        color: "#6A5ACD" // SlateBlue
      },
      // ... (add other moods similarly)
    };

    // Advanced mood detection with scoring system
    let detectedMoods = [];
    for (const [mood, data] of Object.entries(moodDatabase)) {
      const score = data.triggers.reduce((acc, trigger) => 
        acc + (text.toLowerCase().includes(trigger) ? 3 : 0) +
        (text.includes(trigger) ? 2 : 0), 0);
      
      if (score > 0) detectedMoods.push({ mood, score, ...data });
    }

    // Determine primary mood (highest score) or mixed mood
    let analysis;
    if (detectedMoods.length === 0) {
      analysis = {
        mood: "neutral",
        emoji: "🔘",
        response: "🌀 *NEUTRAL STATE*\nQueen Ruva detects calm waters. The world awaits your spark!",
        color: "#808080"
      };
    } else if (detectedMoods.length === 1) {
      analysis = detectedMoods[0];
    } else {
      // Mixed mood analysis
      analysis = {
        mood: "complex",
        emoji: "🌗",
        response: `🌪️ *COMPLEX EMOTIONS*\nQueen Ruva perceives multiple layers:\n` +
          detectedMoods.slice(0, 3).map(m => `• ${m.emoji} ${m.mood}`).join('\n') +
          `\n\nSuch depth! The human experience is fascinating.`,
        color: "#9370DB" // MediumPurple
      };
    }

    // Send interactive response
    await bot.sendMessage(
      chatId,
      `╔═══════════════════════\n` +
      `  👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊* 👑\n` +
      `  🔍 *Emotional Analysis*\n` +
      `╚═══════════════════════\n\n` +
      `📜 *Analyzed Text:*\n_"${text.length > 100 ? text.slice(0, 100) + '...' : text}"_\n\n` +
      `${analysis.emoji} *Dominant Mood:* ${analysis.mood.toUpperCase()}\n` +
      `${analysis.response}\n\n` +
      `🎨 *Emotional Color:* ${analysis.color}\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );

    // Send mood sticker if available
    if (analysis.sticker) {
      await bot.sendSticker(chatId, analysis.sticker);
    }

  } catch (error) {
    console.error("Mood analysis error:", error);
    await bot.sendMessage(
      chatId,
      `❌ *Royal Analysis Failure*\n` +
      `Queen Ruva's crystal ball fogged up!\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
  case "mooddetector": {
  try {
    const text = msg.reply_to_message?.text || msg.text.split(' ').slice(1).join(' ');

    if (!text) {
      return bot.sendMessage(
        chatId,
        `🎭 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 - Mood Detector* 🎭\n\n` +
        `🔍 _Usage:_ Reply to a message or type \`/mooddetector [text]\` to analyze mood!\n\n` +
        `✨ _ ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ_`,
        { parse_mode: "Markdown" }
      );
    }

    // Mood database (keywords + responses)
    const moodDatabase = {
      happy: {
        keywords: ["happy", "joy", "yay", "awesome", "great", "😊", "😄"],
        emoji: "🌟",
        response: "🎉 **HAPPINESS DETECTED!**\nQueen Ruva senses your radiant positivity! Shine on! ✨"
      },
      sad: {
        keywords: ["sad", "cry", "depress", "unhappy", "😢", "😭"],
        emoji: "☔",
        response: "💧 **SADNESS DETECTED...**\n*Queen Ruva sends virtual hugs* 🫂\nIt's okay—tomorrow is a new day! 💙"
      },
      angry: {
        keywords: ["angry", "mad", "hate", "annoy", "😠", "🤬"],
        emoji: "💢",
        response: "⚡ **ANGER ALERT!**\nQueen Ruva advises: Breathe in... breathe out... 🧘‍♀️\nDon't let rage win!"
      },
      love: {
        keywords: ["love", "heart", "crush", "romance", "❤️", "😍"],
        emoji: "💘",
        response: "🌹 **LOVE IS IN THE AIR!**\nQueen Ruva detects *romantic vibes*!\nSomeone’s smitten~ 💌"
      },
      confused: {
        keywords: ["confuse", "what", "?", "huh", "🤔", "😵"],
        emoji: "🌀",
        response: "🔍 **CONFUSION DETECTED!**\nQueen Ruva offers wisdom: Ask, and I shall answer! 📚"
      },
      excited: {
        keywords: ["excite", "wow", "yay", "🎉", "🚀"],
        emoji: "✨",
        response: "🌈 **EXCITEMENT OVERLOAD!**\nQueen Ruva shares your hype! *Something amazing is coming!* 🎊"
      },
      tired: {
        keywords: ["tired", "sleep", "zzz", "😴", "🥱"],
        emoji: "🛌",
        response: "🌙 **EXHAUSTION DETECTED.**\nQueen Ruva prescribes: Rest, mortal! ☕ or 🛏️?"
      }
    };

    // Default mood (if no match)
    let result = {
      mood: "neutral",
      emoji: "🔮",
      response: "🤖 **MOOD UNKNOWN.**\nQueen Ruva is puzzled... Be more expressive! 🎭"
    };

    // Detect mood from text
    for (const [mood, data] of Object.entries(moodDatabase)) {
      if (data.keywords.some(word => text.toLowerCase().includes(word))) {
        result = { mood, ...data };
        break;
      }
    }

    // Send the branded mood report
    bot.sendMessage(
      chatId,
      `╔═══════════════════════\n` +
      `  🎭 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊* 🎭\n` +
      `  🔮 *Mood Analysis Report*\n` +
      `╚═══════════════════════\n\n` +
      `💬 *Text Scanned:*\n_"${text.length > 30 ? text.slice(0, 30) + '...' : text}"_\n\n` +
      `${result.emoji} **Detected Mood:** ${result.mood.toUpperCase()}\n` +
      `${result.response}\n\n` +
      `⚡ _ ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ_`,
      { parse_mode: "Markdown" }
    );

  } catch (error) {
    console.error("Mooddetector error:", error);
    bot.sendMessage(
      chatId,
      `❌ *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 Error*\nMood analysis failed! Try again later.\n\n` +
      `_⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ_`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
  case "help": {
  // Show the typing indicator
  bot.sendChatAction(chatId, 'typing');

  // Adding a delay before showing the help messages
  setTimeout(() => {
    const helpMessages = [
      `⌛ *Processing your request...* Please wait...`,
      `╭────────────────────────────────
│     *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 HELP GUIDE*   
│────────────────────────────────
│ ℹ️ Welcome to *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*  
│    Explore all the features and commands:
│  
│ 📋 Available Commands:
│  
│  QUOTES         ✨ Get an inspiring quote
│  FACT           🔍 Get a random fact
│  PRANK          🤭 Engage in a fun prank
│  ABOUT          ♻️ Learn more about the owner 
│  OWNER          👤 Meet the founder
│  DATE           💯 Get today’s date
│  INFO           👤 View user info by ID
│  USERINFO       👤 Get detailed user information
│  IMG            🖼️ Search for dog images
│  ANIME          🖼️ Search for anime images
│  YOUTUBE        📹 Search YouTube for tutorials (e.g., how to deploy a WhatsApp bot for free)
│  MENU           🍽️ View the available menu options
│  SETTING        ⚙️ Modify bot settings
│  DEEPSEEK       🤖 Ask a question for AI responses
│  OPENAI         🧠 Ask an OpenAI-powered question
│  LLAMA          🦙 Ask a Llama-based question
│  INVITE         📲 Share the bot with others
│  LYRICS         🎵 Find lyrics by song title and artist
│  BROADCAST      📡 Send messages to groups
│  GROUPINFO      👥 Check group members
│  WHATSAPP       📱 Access the Queen Ruva AI WhatsApp bot
│  FEEDBACK       📝 Send feedback to the developer
│  FILE           💻 Get WhatsApp bot files
│  REPO           🪀 Access the WA repository 
│  GITCLONE       🔗 GitHub clone repository link
│  SEARCHREPO     🔍 Search for repositories
│  GITHUBUSER     🧑‍💻 Find GitHub user repositories
│  SOCIAL         🌐 Find a social media user profile
│  GENPASSWORD    🔐 Generate a secure password
│  TEMPEMAIL      📧 Create a temporary email address
│  REVERSE        🔄 Reverse text input (e.g., "iconic tech" ➡️ "hcet cinoi")
│  SSWEB             💻ssweb (social media link)
│ STICKER              ⏳sticker (reply imgs ir video)
│ TTS               ♻️tts (hello) bot reply audio
│ AI                ♻️ AI (ask)
│ PIXABAY          💻pixabay (name of Imgs)
│ AUTOTYPING         ♻️autotype (just for funny)
│ MOODDETECTOR      💻mooddetector (happy)
│ MOOD               😔mood (sad)
│ CONTACT          📞 contact owner 
│  
│ 🚧 Some commands are still in development.
│   Stay tuned as our engineering team works on more features! 🛠️
│  
│ Powered by ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ
╰────────────────────────────────`
    ];

    let lastMessageId = null;

    helpMessages.forEach((message, i) => {
      setTimeout(() => {
        // Send the new loading message
        bot.sendMessage(chatId, message).then((sentMessage) => {
          // If there's a previous message, delete it
          if (lastMessageId) {
            bot.deleteMessage(chatId, lastMessageId).catch(() => {});
          }
          lastMessageId = sentMessage.message_id;
        });
      }, i * 1500); // Delay each message by 1.5 seconds for a slower typing speed
    });

    // After all help messages are sent, send footer
    setTimeout(() => {
      bot.sendMessage(chatId, "✨ *Created by Iconic Tech* ✨");
    }, (helpMessages.length + 1) * 1500); // Adjust delay according to the number of help messages

  }, 1000); // Initial delay for typing indicator
}
break;
case "weather": {
  const args = msg.text.split(" ").slice(1); // Get the arguments after the command
  const query = args.join(" "); // Combine arguments into a search query

  // Check if a query is provided
  if (!query) {
    return bot.sendMessage(msg.chat.id, `*Example*: /weather Bulawayo`, { parse_mode: "Markdown" });
  }

  // Array of weather-related emojis
  const weatherEmojis = ['🌤️', '⛅', '🌧️', '🌪️', '☀️', '❄️', '🌩️', '🌬️'];
  const reaction = weatherEmojis[Math.floor(Math.random() * weatherEmojis.length)]; // Pick random emoji

  try {
    const apiUrl = `https://api.popcat.xyz/weather?q=${encodeURIComponent(query)}`;
    console.log("Fetching weather data from:", apiUrl);

    const response = await fetch(apiUrl);

    // Check if the response is OK
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const jsonData = await response.json();

    if (jsonData && jsonData.length > 0) {
      const locationData = jsonData.find(location => location.location.name.toLowerCase().includes(query.toLowerCase()));

      if (locationData) {
        const { current, forecast, location } = locationData;

        let message = `📍 *Weather in ${location.name}* 🌍\n\n`;
        message += `🌦️ Weather: ${current.skytext}\n`;
        message += `🌡️ Temperature: ${current.temperature}°C\n`;
        message += `🥶 Feels Like: ${current.feelslike}°C\n`;
        message += `💧 Humidity: ${current.humidity}%\n`;
        message += `💨 Wind Speed: ${current.winddisplay}\n`;
        message += `📆 Date: ${current.date}\n\n`;

        // Extra message for today’s weather
        message += `⚡️ *Today’s Weather Summary:*\n`;
        message += `> 🌦️ *Condition*: ${current.skytext}\n`;
        message += `> 🌡️ *Current Temperature*: ${current.temperature}°C\n`;
        message += `> 💧 *Humidity*: ${current.humidity}%\n`;
        message += `> 💨 *Wind Speed*: ${current.winddisplay}\n\n`;

        if (forecast && forecast.length > 0) {
          message += `*🔮 Forecast:*\n`;
          forecast.forEach(day => {
            message += `> ${day.day} (${day.date}): ${day.skytextday}, High: ${day.high}°C, Low: ${day.low}°C, Precip: ${day.precip}%\n`;
          });
        }

        // Send the weather message
        await bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });

        // Send a thumbnail (optional)
        await bot.sendPhoto(msg.chat.id, "https://example.com/weather-thumbnail.jpg", {
          caption: `Here's the weather for ${location.name}!`,
        });
      } else {
        await bot.sendMessage(msg.chat.id, `Could not find weather information for "${query}". Try another location.`);
      }
    } else {
      await bot.sendMessage(msg.chat.id, `Failed to fetch weather data for "${query}". Please try again later.`);
    }
  } catch (error) {
    console.error("Error fetching weather data:", error);
    await bot.sendMessage(msg.chat.id, "An error occurred while fetching the weather data. Please try again later.");
  }
  break;
}
case 'url': {
    try {
        // Check if a reply message exists (image, video, or audio)
        if (!msg.reply_to_message) {
            return bot.sendMessage(msg.chat.id, "📌 *Please reply to an image, video, or audio file to get the URL!*");
        }

        const quoted = msg.reply_to_message; // Get the quoted message

        let mediaPath;
        try {
            // Check if the quoted message is an image, video, or audio
            if (quoted.photo) {
                // Get the highest resolution image
                const fileId = quoted.photo[quoted.photo.length - 1].file_id;
                mediaPath = await bot.getFileLink(fileId);
            } else if (quoted.video) {
                const fileId = quoted.video.file_id;
                mediaPath = await bot.getFileLink(fileId);
            } else if (quoted.audio) {
                const fileId = quoted.audio.file_id;
                mediaPath = await bot.getFileLink(fileId);
            } else {
                return bot.sendMessage(msg.chat.id, "⚠️ *Only image, video, or audio is allowed.*");
            }
        } catch (err) {
            console.error("❌ Error while retrieving media:", err);
            return bot.sendMessage(msg.chat.id, "❌ *Unable to retrieve media file. Please try again!*");
        }

        if (!mediaPath) {
            return bot.sendMessage(msg.chat.id, "⚠️ *No media file detected. Please reply to an image, video, or audio message.*");
        }

        // Send the media URL as a reply
        await bot.sendMessage(msg.chat.id, `✅ *Successfully fetched the media URL!*\n🌐 *Here is your URL:* ${mediaPath}`);
    } catch (error) {
        console.error("❌ Error during URL generation:", error);
        bot.sendMessage(msg.chat.id, "❌ *Oops, something went wrong while generating your URL. Please try again!*");
    }
    break;
}
case "sticker": {
  try {
    // Check if the message is a reply
    if (!msg.reply_to_message) {
      return bot.sendMessage(msg.chat.id, "❌ Reply to an image or video with the caption /sticker");
    }

    const quoted = msg.reply_to_message; // Get the quoted message

    // Check if the quoted message is an image or video
    if (quoted.photo) {
      // Handle image
      const fileId = quoted.photo[quoted.photo.length - 1].file_id; // Get the highest resolution photo
      const fileUrl = await bot.getFileLink(fileId); // Get the file URL

      // Download the image
      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer(); // Get the ArrayBuffer
      const media = Buffer.from(arrayBuffer); // Convert ArrayBuffer to Buffer

      // Convert image to sticker
      await bot.sendSticker(msg.chat.id, media, {
        reply_to_message_id: msg.message_id, // Reply to the original message
        emojis: "😊", // Optional: Add emojis to the sticker
      });
    } else if (quoted.video) {
      // Handle video
      const fileId = quoted.video.file_id; // Get the video file ID
      const fileUrl = await bot.getFileLink(fileId); // Get the file URL

      // Download the video
      const response = await fetch(fileUrl);
      const arrayBuffer = await response.arrayBuffer(); // Get the ArrayBuffer
      const media = Buffer.from(arrayBuffer); // Convert ArrayBuffer to Buffer

      // Check video duration (Telegram allows up to 3 seconds for video stickers)
      if (quoted.video.duration > 3) {
        return bot.sendMessage(msg.chat.id, "❌ Maximum video duration is 3 seconds!");
      }

      // Convert video to sticker
      await bot.sendSticker(msg.chat.id, media, {
        reply_to_message_id: msg.message_id, // Reply to the original message
        emojis: "🎥", // Optional: Add emojis to the sticker
      });
    } else {
      return bot.sendMessage(msg.chat.id, "❌ Reply to an image or video with the caption /sticker\nVideo duration must be 1-3 seconds");
    }
  } catch (error) {
    console.error("Error during /sticker command:", error);
    bot.sendMessage(msg.chat.id, "❌ An error occurred while processing the /sticker command. Please try again later.");
  }
  break;
}
case "ping": {
  try {
    const start = Date.now();
    
    // Send initial loading animation
    const loadingMsg = await bot.sendMessage(
      chatId,
      `⚡ *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 System Check* ⚡\n\n` +
      `▰▰▰▰▰▰▰▰▰▰ 20%\n\n` +
      `Initializing quantum diagnostics...`,
      { parse_mode: "Markdown" }
    );

    // Simulate loading progress
    for (let i = 40; i <= 100; i += 20) {
      await new Promise(resolve => setTimeout(resolve, 150));
      await bot.editMessageText(
        `⚡ *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 System Check* ⚡\n\n` +
        `${'▰'.repeat(i/10)}${'▱'.repeat(10-(i/10))} ${i}%\n\n` +
        `${i < 80 ? 'Analyzing neural networks...' : 'Finalizing diagnostics...'}`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
          parse_mode: "Markdown"
        }
      );
    }

    const latency = Date.now() - start;
    const uptime = process.uptime();

    // Format uptime with emoji indicators
    const formatRuntime = (seconds) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      return `${h}🌙 ${m}⏳ ${s}⚡`;
    };

    // Create ASCII art box with dynamic width
    const createStatusBox = (latency, uptime) => {
      const lines = [
        `👑 *QUEEN RUVA STATUS* 👑`,
        `┏${'━'.repeat(28)}┓`,
        `┃ 🚀 Latency: ${latency.toFixed(2)}ms${' '.repeat(28-16-latency.toFixed(2).length)}┃`,
        `┃ ⚡ Response: ${latency}ms${' '.repeat(28-15-latency.toString().length)}┃`,
        `┃ 🕒 Uptime: ${formatRuntime(uptime)}${' '.repeat(28-14-formatRuntime(uptime).length)}┃`,
        `┗${'━'.repeat(28)}┛`
      ];
      return lines.join('\n');
    };

    // Final response with interactive buttons
    await bot.editMessageText(
      `⚡ *SYSTEM DIAGNOSTICS COMPLETE* ⚡\n\n` +
      `${createStatusBox(latency, uptime)}\n\n` +
      `💎 *Performance Tier:* ${latency < 200 ? 'DIAMOND' : latency < 500 ? 'GOLD' : 'SILVER'}\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "🔄 Re-run Diagnostics",
              callback_data: "reping"
            }],
            [{
              text: "📊 System Details",
              callback_data: "sysinfo"
            }]
          ]
        }
      }
    );

    // Callback handlers
    bot.on('callback_query', async (callbackQuery) => {
      if (callbackQuery.data === "reping") {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Re-running diagnostics..." });
        // Trigger the ping command again
        bot.sendMessage(chatId, "/ping", { parse_mode: "Markdown" });
      }
      else if (callbackQuery.data === "sysinfo") {
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.sendMessage(
          chatId,
          `🖥️ *System Specifications*\n\n` +
          `• Node.js: ${process.version}\n` +
          `• Platform: ${process.platform}\n` +
          `• Memory: ${(process.memoryUsage().rss / 1024 / 1024).toFixed(2)}MB\n\n` +
          `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
          `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
          { parse_mode: "Markdown" }
        );
      }
    });

  } catch (error) {
    console.error("Ping command error:", error);
    await bot.sendMessage(
      chatId,
      `⚠️ *Quantum Fluctuation Detected*\n\n` +
      `Temporal diagnostics failed!\n` +
      `Error: ${error.message}\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
case "runtime": {
  try {
    // Send initial loading animation
    const loadingMsg = await bot.sendMessage(
      chatId,
      `⏳ *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 - System Diagnostics* ⏳\n\n` +
      `▰▱▱▱▱▱▱▱▱▱ 10%\n\n` +
      `Initializing temporal analysis...`,
      { parse_mode: "Markdown" }
    );

    // Simulate diagnostic progress
    for (let i = 30; i <= 100; i += 20) {
      await new Promise(resolve => setTimeout(resolve, 200));
      await bot.editMessageText(
        `⏳ *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 - System Diagnostics* ⏳\n\n` +
        `${'▰'.repeat(i/10)}${'▱'.repeat(10-(i/10))} ${i}%\n\n` +
        `${i < 70 ? 'Scanning neural networks...' : 'Finalizing temporal scan...'}`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
          parse_mode: "Markdown"
        }
      );
    }

    const uptime = process.uptime();

    // Enhanced runtime formatting with emoji indicators
    const formatRuntime = (seconds) => {
      const d = Math.floor(seconds / 86400);
      const h = Math.floor((seconds % 86400) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);
      return `${d > 0 ? `${d}🌙 ` : ''}${h}🕒 ${m}⏳ ${s}⚡`;
    };

    // Create dynamic ASCII art display
    const createRuntimeDisplay = (uptime) => {
      const runtimeText = formatRuntime(uptime);
      const boxWidth = Math.max(28, runtimeText.length + 12);
      return [
        `┏${'━'.repeat(boxWidth)}┓`,
        `┃ 🚀 *UPTIME STATUS*${' '.repeat(boxWidth-17)}┃`,
        `┃${' '.repeat(boxWidth)}┃`,
        `┃   ${runtimeText}${' '.repeat(boxWidth-runtimeText.length-3)}┃`,
        `┗${'━'.repeat(boxWidth)}┛`
      ].join('\n');
    };

    // Final response with interactive buttons
    await bot.editMessageText(
      `⚡ *SYSTEM DIAGNOSTICS COMPLETE* ⚡\n\n` +
      `${createRuntimeDisplay(uptime)}\n\n` +
      `💎 *Stability Rating:* ${uptime > 86400 ? 'PLATINUM' : uptime > 43200 ? 'GOLD' : 'SILVER'}\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "🔄 Refresh Status",
              callback_data: "refresh_runtime"
            }],
            [{
              text: "📊 System Health",
              callback_data: "system_health"
            }]
          ]
        }
      }
    );

    // Callback handlers
    bot.on('callback_query', async (callbackQuery) => {
      if (callbackQuery.data === "refresh_runtime") {
        await bot.answerCallbackQuery(callbackQuery.id, { text: "Refreshing runtime..." });
        // Trigger the command again
        bot.sendMessage(chatId, "/runtime", { parse_mode: "Markdown" });
      }
      else if (callbackQuery.data === "system_health") {
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.sendMessage(
          chatId,
          `🖥️ *System Health Report*\n\n` +
          `• CPU Usage: ${(process.cpuUsage().user / 1000000).toFixed(2)}%\n` +
          `• Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB/${(process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2)}MB\n` +
          `• Platform: ${process.platform}\n\n` +
          `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
          `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
          { parse_mode: "Markdown" }
        );
      }
    });

  } catch (error) {
    console.error("Runtime command error:", error);
    await bot.sendMessage(
      chatId,
      `⚠️ *Temporal Anomaly Detected*\n\n` +
      `Failed to complete diagnostics!\n` +
      `Error: ${error.message}\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
case "wikipedia": {
  try {
    // Show typing indicator
    await bot.sendChatAction(chatId, "typing");

    const args = msg.text.split(" ").slice(1);
    const query = args.join(" ");

    if (!query) {
      return bot.sendMessage(
        chatId,
        `🔍 *Wikipedia Search*\n\n` +
        `Usage: /wikipedia <search term>\n` +
        `Example: /wikipedia Artificial Intelligence\n\n` +
        `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
        `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        { parse_mode: "Markdown" }
      );
    }

    // Fetch Wikipedia data
    const apiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const data = await response.json();

    // Handle disambiguation pages
    if (data.type === "disambiguation") {
      return bot.sendMessage(
        chatId,
        `⚠️ *Multiple Results Found*\n\n` +
        `"${query}" may refer to:\n\n` +
        `Please refine your search for more specific results.\n\n` +
        `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
        `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        { parse_mode: "Markdown" }
      );
    }

    // Prepare rich response
    let message = `📚 *${data.title}*\n\n`;
    
    // Add description if available
    if (data.description) {
      message += `*${data.description}*\n\n`;
    }
    
    message += `${data.extract}\n\n`;
    
    // Add Wikipedia link
    if (data.content_urls && data.content_urls.desktop) {
      message += `[🔗 Read more on Wikipedia](${data.content_urls.desktop.page})\n\n`;
    }
    
    message += `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
               `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`;

    // Split message into chunks (Telegram's limit is 4096 chars per message)
    const chunks = [];
    while (message.length > 0) {
      let chunk = message.substring(0, 4096);
      const lastNewLine = chunk.lastIndexOf('\n');
      if (lastNewLine > 0 && chunk.length === 4096) {
        chunk = chunk.substring(0, lastNewLine);
      }
      chunks.push(chunk);
      message = message.substring(chunk.length);
    }

    // Send thumbnail with first chunk as caption if available
    if (data.thumbnail && data.thumbnail.source) {
      await bot.sendChatAction(chatId, "upload_photo");
      await bot.sendPhoto(
        chatId,
        data.thumbnail.source,
        {
          caption: chunks[0],
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{
                text: "📖 Full Article",
                url: data.content_urls.desktop.page
              }]
            ]
          }
        }
      );
      
      // Send remaining chunks
      for (let i = 1; i < chunks.length; i++) {
        await bot.sendMessage(chatId, chunks[i], { parse_mode: "Markdown" });
      }
    } else {
      // Send all chunks as messages if no thumbnail
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk, { parse_mode: "Markdown" });
      }
    }

  } catch (error) {
    console.error("Wikipedia command error:", error);
    await bot.sendMessage(
      chatId,
      `❌ *Knowledge Retrieval Failed*\n\n` +
      `Couldn't fetch information about "${query}"\n\n` +
      `Possible reasons:\n` +
      `• Article doesn't exist\n` +
      `• Connection issues\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
case "google": {
  try {
    const args = msg.text.split(" ").slice(1); // Get the arguments after the command
    const query = args.join(" "); // Combine arguments into a search query

    // Check if a query is provided
    if (!query) {
      return bot.sendMessage(msg.chat.id, `*Example*: /google cat`, { parse_mode: "Markdown" });
    }

    const apiUrlForImages = `https://api.giftedtech.my.id/api/search/googleimage?apikey=gifted&query=${encodeURIComponent(query)}`;

    // Fetch images from API
    const response = await fetch(apiUrlForImages);
    const data = await response.json();

    if (!data.success || !data.results.length) {
      return bot.sendMessage(msg.chat.id, `*No images found for:* ${query}`, { parse_mode: "Markdown" });
    }

    // Send the extra message before the images
    const extraMessage = `ᴡᴀɪᴛ......`;
    await bot.sendMessage(msg.chat.id, extraMessage);

    // Footer to be added to the image caption
    const footer = "\n\n**ɢᴇɴᴇʀᴀᴛᴇᴅ ʙʏ ǫᴜᴇᴇɴ ʀᴜᴠᴀ ᴀɪ**";

    // Limit to 5 images max
    const images = data.results.slice(0, 5);

    // Send each fetched image
    for (const imageUrl of images) {
      await bot.sendPhoto(msg.chat.id, imageUrl, {
        caption: footer,
        parse_mode: "Markdown",
      });
    }
  } catch (error) {
    console.error("Error fetching images:", error);
    bot.sendMessage(msg.chat.id, "*An error occurred while fetching images. Please try again later.*", { parse_mode: "Markdown" });
  }
  break;
}
// Add this to your command handlers
case "pixabay": {
  const chatId = msg.chat.id;
  const args = msg.text.split(" ").slice(1);
  const userQuery = args.join(" ").trim();

  // NSFW keyword filter
  const nsfwKeywords = [
    'porn', 'xxx', 'sex', 'tities', 'titties', 'nude', 'nsfw', 'hentai', 'adult', 'erotic',
    'pornography', 'sexy', 'fuck', 'dick', 'cock', 'pussy', 'ass', 'boobs',
    'tits', 'naked', 'nudes', 'blowjob', 'cum', 'suck', 'fucking', 'anal',
    'vagina', 'penis', 'bdsm', 'fetish', 'hardcore', 'masturbation'
  ];

  // Check for NSFW content
  const containsNSFW = nsfwKeywords.some(keyword => 
    userQuery.toLowerCase().includes(keyword.toLowerCase())
  );

  if (containsNSFW) {
    return bot.sendMessage(
      chatId,
      `⚠️ *NSFW Content Blocked* ⚠️\n\n` +
      `Your search contains blocked keywords.\n` +
      `This bot does not support NSFW content.\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }

  if (!userQuery) {
    return bot.sendMessage(
      chatId,
      `🌄 *Pixabay Image Search* 🌄\n\n` +
      `Usage: /pixabay <search term>\n` +
      `Example: /pixabay mountain sunset\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }

  try {
    // Show loading animation
    const loadingMsg = await bot.sendMessage(
      chatId,
      `🔍 *Searching Pixabay* 🔍\n\n` +
      `▰▱▱▱▱▱▱▱▱▱ 25%\n` +
      `Looking for "${userQuery}"...`,
      { parse_mode: "Markdown" }
    );

    // Pixabay API URL
    const apiUrl = `https://api.nexoracle.com/search/pixabay-images?apikey=63b406007be3e32b53&q=${encodeURIComponent(userQuery)}`;

    // Fetch images with timeout
    const response = await fetch(apiUrl);
    const data = await response.json();

    if (!data?.result?.length) {
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      return bot.sendMessage(
        chatId,
        `❌ *No Images Found* ❌\n\n` +
        `Couldn't find Pixabay images for:\n"${userQuery}"\n\n` +
        `• Try different keywords\n` +
        `• Use English terms for best results\n\n` +
        `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
        `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        { parse_mode: "Markdown" }
      );
    }

    // Send first 5 images with delay
    let imagesSent = 0;
    for (let i = 0; i < Math.min(data.result.length, 5); i++) {
      try {
        await bot.sendPhoto(
          chatId,
          data.result[i],
          {
            caption: `🖼️ Image ${i+1} for "${userQuery}"\n\n` +
                     `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
                     `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
            parse_mode: "Markdown"
          }
        );
        imagesSent++;
        // Add delay between images to avoid rate limiting
        if (i < 4) await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Error sending image ${i+1}:`, error);
      }
    }

    // Completion message
    await bot.sendMessage(
      chatId,
      `✅ Sent ${imagesSent} Pixabay images for "${userQuery}"\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );

    await bot.deleteMessage(chatId, loadingMsg.message_id);

  } catch (error) {
    console.error("Pixabay command error:", error);
    await bot.sendMessage(
      chatId,
      `⚠️ *Pixabay Search Failed* ⚠️\n\n` +
      `Error: ${error.message}\n\n` +
      `• Try again later\n` +
      `• Contact support if issue persists\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
case "bible": {
  const chatId = msg.chat.id;
  const args = msg.text.split(" ").slice(1);
  const reference = args.join(" ").trim(); // e.g., "John 3:16"

  if (!reference) {
    return bot.sendMessage(
      chatId,
      `📖 *Bible Verse Lookup*\n\n`
      + `Usage: /bible <reference>\n`
      + `Example: /bible John 3:16\n\n`
      + `_Available translations: KJV, NIV, ESV_`,
      { parse_mode: "Markdown" }
    );
  }

  try {
    const loadingMsg = await bot.sendMessage(chatId, `🔍 Searching for ${reference}...`);
    
    const response = await fetch(`https://bible-api.com/${encodeURIComponent(reference)}?translation=kjv`);
    const data = await response.json();

    await bot.sendMessage(
      chatId,
      `✝️ *${data.reference} (KJV)*\n\n${data.text}\n\n`
      + `_${data.verses.length} verses found_`,
      { parse_mode: "Markdown" }
    );

    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    await bot.sendMessage(chatId, `❌ Verse not found. Try another reference.`);
  }
  break;
}

case "quran": {
  const chatId = msg.chat.id;
  const args = msg.text.split(" ").slice(1);
  const reference = args.join(" ").trim(); // "2:255"

  if (!reference) {
    return bot.sendMessage(
      chatId,
      `📿 *Quran Verse (Clear Quran)* 📿\n\n`
      + `Usage: /quran <surah:ayah>\n`
      + `Example: /quran 2:255\n\n`
      + `👑 𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊`,
      { parse_mode: "Markdown" }
    );
  }

  try {
    const loadingMsg = await bot.sendMessage(chatId, `⏳ Fetching Ayah ${reference}...`);
    const [surah, ayah] = reference.split(':');
    const response = await fetch(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/en.maarif`);
    const data = await response.json();
    
    await bot.sendMessage(
      chatId,
      `🕌 *Surah ${data.data.surah.englishName} ${reference}* 🕌\n\n`
      + `${data.data.text}\n\n`
      + `_${data.data.surah.englishNameTranslation} (${data.data.edition.name})_\n\n`
      + `👑 𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊`,
      { parse_mode: "Markdown" }
    );
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    await bot.sendMessage(chatId, "❌ Ayah not found. Try format: 'Surah:Ayah'");
  }
  break;
}

case "dhammapada": {
  const chatId = msg.chat.id;
  const args = msg.text.split(" ").slice(1);
  const chapter = args[0]; // "1"

  if (!chapter) {
    return bot.sendMessage(
      chatId,
      `☸️ *Dhammapada Chapter* ☸️\n\n`
      + `Usage: /dhammapada <chapter>\n`
      + `Example: /dhammapada 1\n\n`
      + `_26 chapters available_\n\n`
      + `👑 𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊`,
      { parse_mode: "Markdown" }
    );
  }

  try {
    const loadingMsg = await bot.sendMessage(chatId, `⏳ Fetching Chapter ${chapter}...`);
    const response = await fetch(`https://dhammapada-api.herokuapp.com/api/chapter/${chapter}`);
    const data = await response.json();
    
    let versesText = data.verses.map(v => `*${v.verse}.* ${v.text}`).join('\n\n');
    
    await bot.sendMessage(
      chatId,
      `☸️ *Dhammapada Chapter ${chapter}: ${data.title}* ☸️\n\n`
      + `${versesText}\n\n`
      + `👑 𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊`,
      { parse_mode: "Markdown" }
    );
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    await bot.sendMessage(chatId, "❌ Chapter not found. Try number 1-26");
  }
  break;
}
  case "img": {
  const chatId = msg.chat.id;
  const args = msg.text.split(" ").slice(1);
  const userQuery = args.join(" ").trim();

  // List of blocked keywords (can be expanded)
  const blockedKeywords = [
    'porn', 'xxx', 'sex', 'tities', 'titties', 'nude', 'nsfw', 'hentai', 'adult', 'erotic',
    'pornography', 'sexy', 'fuck', 'dick', 'cock', 'pussy', 'ass', 'boobs',
    'tits', 'naked', 'nudes', 'blowjob', 'cum', 'suck', 'fucking', 'anal',
    'vagina', 'penis', 'bdsm', 'fetish', 'hardcore', 'masturbation'
  ];

  // Check if query contains any blocked keywords
  const containsBlocked = blockedKeywords.some(keyword => 
    userQuery.toLowerCase().includes(keyword.toLowerCase())
  );

  if (containsBlocked) {
    return bot.sendMessage(
      chatId,
      `⚠️ *Content Not Allowed* ⚠️\n\n` +
      `Your search for "${userQuery}" contains blocked terms.\n` +
      `This bot does not allow adult content searches.\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 �𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 �𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }

  if (!userQuery) {
    return bot.sendMessage(
      chatId,
      `📸 *Image Search* 📸\n\n` +
      `Usage: /img <search term>\n` +
      `Example: /img sunset\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 �𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }

  try {
    // Show loading animation
    const loadingMsg = await bot.sendMessage(
      chatId,
      `🔍 *Searching Images* 🔍\n\n` +
      `▰▱▱▱▱▱▱▱▱▱ 20%\n` +
      `Looking for "${userQuery}"...`,
      { parse_mode: "Markdown" }
    );

    // Fetch images
    const apiUrl = `https://img.hazex.workers.dev/?prompt=${encodeURIComponent(userQuery)}`;
    const response = await fetch(apiUrl);
    
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    // Send all 5 images directly
    let imagesSent = 0;
    for (let i = 1; i <= 5; i++) {
      try {
        const imageUrl = `${apiUrl}&index=${i}`;
        await bot.sendPhoto(
          chatId,
          imageUrl,
          {
            caption: `🖼️ Image ${i} for "${userQuery}"\n\n` +
                     `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
                     `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
            parse_mode: "Markdown"
          }
        );
        imagesSent++;
      } catch (imageError) {
        console.error(`Error sending image ${i}:`, imageError);
        // Continue to next image if one fails
      }
    }

    if (imagesSent === 0) {
      throw new Error('No images could be sent');
    }

    // Final message showing completion
    await bot.sendMessage(
      chatId,
      `✅ Sent ${imagesSent} images for "${userQuery}"\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );

    await bot.deleteMessage(chatId, loadingMsg.message_id);

  } catch (error) {
    console.error("Image command error:", error);
    await bot.sendMessage(
      chatId,
      `⚠️ *Image Search Failed* ⚠️\n\n` +
      `Couldn't find images for "${userQuery}"\n` +
      `• Try different keywords\n` +
      `• Check your spelling\n` +
      `• The service might be temporarily unavailable\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
//NEW RANDOM 
case "dog": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🐶 Fetching a cute dog...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://dog.ceo/api/breeds/image/random');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.message, {
      caption: "🐕 Random Dog Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Dog command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a dog picture. Try again later.");
  }
  break;
}

case "cat": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🐱 Finding a fluffy cat...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://api.thecatapi.com/v1/images/search');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data[0].url, {
      caption: "🐈 Random Cat Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Cat command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a cat picture. Try again later.");
  }
  break;
}

case "fox": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🦊 Searching for a fox...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://randomfox.ca/floof/');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.image, {
      caption: "🦊 Random Fox Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Fox command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a fox picture. Try again later.");
  }
  break;
}

case "duck": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🦆 Looking for a duck...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://random-d.uk/api/v2/random');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.url, {
      caption: "🦆 Random Duck Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Duck command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a duck picture. Try again later.");
  }
  break;
}
//. NEW TAG
case "panda": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🐼 Finding a cute panda...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://some-random-api.ml/img/panda');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.link, {
      caption: "🐼 Random Panda Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Panda command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a panda picture. Try again later.");
  }
  break;
}

case "koala": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🐨 Searching for a koala...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://some-random-api.ml/img/koala');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.link, {
      caption: "🐨 Random Koala Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Koala command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a koala picture. Try again later.");
  }
  break;
}

case "bird": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🐦 Looking for a beautiful bird...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://some-random-api.ml/img/birb');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.link, {
      caption: "🐦 Random Bird Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Bird command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a bird picture. Try again later.");
  }
  break;
}

case "redpanda": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🐾 Finding a red panda...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://some-random-api.ml/img/red_panda');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.link, {
      caption: "🐾 Random Red Panda Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Red panda command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a red panda picture. Try again later.");
  }
  break;
}

case "kangaroo": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🦘 Searching for a kangaroo...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://some-random-api.ml/img/kangaroo');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.link, {
      caption: "🦘 Random Kangaroo Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Kangaroo command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a kangaroo picture. Try again later.");
  }
  break;
}

case "raccoon": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🦝 Looking for a raccoon...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://some-random-api.ml/img/raccoon');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.link, {
      caption: "🦝 Random Raccoon Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 �𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Raccoon command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a raccoon picture. Try again later.");
  }
  break;
}

case "whale": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🐋 Finding a majestic whale...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://some-random-api.ml/img/whale');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.link, {
      caption: "🐋 Random Whale Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Whale command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a whale picture. Try again later.");
  }
  break;
}

case "dolphin": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🐬 Searching for a dolphin...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://some-random-api.ml/img/dolphin');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.link, {
      caption: "🐬 Random Dolphin Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Dolphin command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a dolphin picture. Try again later.");
  }
  break;
}

case "elephant": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🐘 Looking for an elephant...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://some-random-api.ml/img/elephant');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.link, {
      caption: "🐘 Random Elephant Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Elephant command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch an elephant picture. Try again later.");
  }
  break;
}

case "giraffe": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🦒 Finding a giraffe...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://some-random-api.ml/img/giraffe');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.link, {
      caption: "🦒 Random Giraffe Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Giraffe command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a giraffe picture. Try again later.");
  }
  break;
}

case "lion": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🦁 Searching for a lion...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://some-random-api.ml/img/lion');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.link, {
      caption: "🦁 Random Lion Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 �𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Lion command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a lion picture. Try again later.");
  }
  break;
}

case "penguin": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🐧 Looking for a penguin...", { parse_mode: "Markdown" });
    
    const response = await fetch('https://some-random-api.ml/img/penguin');
    const data = await response.json();
    
    await bot.sendPhoto(chatId, data.link, {
      caption: "🐧 Random Penguin Picture\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      parse_mode: "Markdown"
    });
    
    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Penguin command error:", error);
    await bot.sendMessage(chatId, "⚠️ Couldn't fetch a penguin picture. Try again later.");
  }
  break;
}
//No TSG

case "history": {
  const chatId = msg.chat.id;
  try {
    const loadingMsg = await bot.sendMessage(chatId, "🕰️ Searching historical agricultural images...", { 
      parse_mode: "Markdown" 
    });

    // Try multiple API sources with fallbacks
    const apiSources = [
      // 1. Wikimedia Commons (high-quality historical images)
      async () => {
        const response = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&generator=images&titles=Historical%20agriculture&prop=imageinfo&iiprop=url&format=json&origin=*&gimlimit=20`);
        const data = await response.json();
        const pages = data.query.pages;
        const randomImage = pages[Object.keys(pages)[0]]; // Get first image
        return {
          url: randomImage.imageinfo[0].url,
          caption: "📜 Historical Agriculture\n\nSource: Wikimedia Commons",
          requiresAttribution: true
        };
      },
      
      // 2. Europeana (cultural heritage) - requires API key but has open collections
      async () => {
        const response = await fetch('https://www.europeana.eu/api/v2/search.json?wskey=apidemo&query=agriculture&media=true&qf=TYPE:IMAGE&qf=YEAR:[1000 TO 1900]&rows=20');
        const data = await response.json();
        const randomItem = data.items[Math.floor(Math.random() * data.items.length)];
        return {
          url: randomItem.edmIsShownBy[0],
          caption: `🏛️ ${randomItem.title[0]}\n\n📍 ${randomItem.dataProvider[0]}\n🔗 [More info](${randomItem.guid})`,
          requiresAttribution: true
        };
      },
      
      // 3. Flickr Fallback (public domain historical photos)
      async () => {
        const response = await fetch('https://www.flickr.com/services/feeds/photos_public.gne?tags=historical,agriculture&format=json&nojsoncallback=1');
        const data = await response.json();
        const randomPhoto = data.items[Math.floor(Math.random() * data.items.length)];
        return {
          url: randomPhoto.media.m.replace('_m.jpg', '_b.jpg'),
          caption: `📷 ${randomPhoto.title}\n\nBy ${randomPhoto.author.split('"')[1]} on Flickr`,
          requiresAttribution: true
        };
      }
    ];

    // Try each source until success
    let result;
    for (const source of apiSources) {
      try {
        result = await source();
        if (result.url) break;
      } catch (e) { /* Silently fail and try next source */ }
    }

    if (!result?.url) throw new Error("All APIs failed");

    await bot.sendPhoto(chatId, result.url, {
      caption: result.caption,
      parse_mode: "Markdown",
      ...(result.requiresAttribution && { 
        reply_markup: {
          inline_keyboard: [[{ text: "🔍 View Source", url: result.url }]]
        }
      })
    });

    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("History command error:", error);
    await bot.sendMessage(chatId, 
      "⚠️ Couldn't fetch historical images. Try these alternatives:\n\n" +
      "• https://oldagriculture.com\n" +
      "• https://agriculturalhistory.org",
      { disable_web_page_preview: true }
    );
  }
  break;
}

case "sadcat": {
  const chatId = msg.chat.id;
  const args = msg.text.split(" ").slice(1);
  const text = args.join(" ").trim();

  if (!text) {
    return bot.sendMessage(
      chatId,
      "😿 *Sad Cat Meme Generator* 😿\n\n" +
      "Usage: /sadcat <your text>\n" +
      "Example: /sadcat When the code doesn't work\n\n" +
      "👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n" +
      "⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      { parse_mode: "Markdown" }
    );
  }

  try {
    const loadingMsg = await bot.sendMessage(
      chatId,
      "⏳ Generating your sad cat meme...",
      { parse_mode: "Markdown" }
    );

    const encodedText = encodeURIComponent(text);
    const imageUrl = `https://api.popcat.xyz/v2/sadcat?text=${encodedText}`;

    await bot.sendPhoto(
      chatId,
      imageUrl,
      {
        caption: `😿 "${text}"\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        parse_mode: "Markdown"
      }
    );

    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Sadcat command error:", error);
    await bot.sendMessage(
      chatId,
      "⚠️ Failed to generate sad cat meme. Try again later."
    );
  }
  break;
}
case "oogway": {
  const chatId = msg.chat.id;
  const args = msg.text.split(" ").slice(1);
  const text = args.join(" ").trim();

  if (!text) {
    return bot.sendMessage(
      chatId,
      "🐢 *Oogway Wisdom Generator* 🐢\n\n" +
      "Usage: /oogway <your wisdom>\n" +
      "Example: /oogway Yesterday is history\n\n" +
      "👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n" +
      "⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      { parse_mode: "Markdown" }
    );
  }

  try {
    const loadingMsg = await bot.sendMessage(
      chatId,
      "⏳ Consulting Master Oogway...",
      { parse_mode: "Markdown" }
    );

    const encodedText = encodeURIComponent(text);
    const imageUrl = `https://api.popcat.xyz/v2/oogway?text=${encodedText}`;

    await bot.sendPhoto(
      chatId,
      imageUrl,
      {
        caption: `🐢 *Master Oogway says:*\n"${text}"\n\n👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        parse_mode: "Markdown"
      }
    );

    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Oogway command error:", error);
    await bot.sendMessage(
      chatId,
      "⚠️ Failed to consult Master Oogway. The peach tree did not blossom..."
    );
  }
  break;
}
case "drake": {
  const chatId = msg.chat.id;
  const args = msg.text.split(" ").slice(1);
  
  // Split into text1 and text2 (using "vs" as separator)
  const fullText = args.join(" ");
  const [text1, text2] = fullText.includes(" vs ") 
    ? fullText.split(" vs ").map(t => t.trim())
    : [args[0] || "", args[1] || ""];

  if (!text1 || !text2) {
    return bot.sendMessage(
      chatId,
      "🎵 *Drake Meme Generator* 🎵\n\n" +
      "Usage: /drake <bad thing> vs <good thing>\n" +
      "Example: /drake homework vs gaming\n" +
      "Or: /drake homework gaming\n\n" +
      "👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n" +
      "⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      { parse_mode: "Markdown" }
    );
  }

  try {
    const loadingMsg = await bot.sendMessage(
      chatId,
      "⏳ Creating your Drake meme...",
      { parse_mode: "Markdown" }
    );

    const encodedText1 = encodeURIComponent(text1);
    const encodedText2 = encodeURIComponent(text2);
    const imageUrl = `https://api.popcat.xyz/v2/drake?text1=${encodedText1}&text2=${encodedText2}`;

    await bot.sendPhoto(
      chatId,
      imageUrl,
      {
        caption: `🎵 *Drake Preference*\n\n` +
                 `❌ ${text1}\n` +
                 `✅ ${text2}\n\n` +
                 `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
                 `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        parse_mode: "Markdown"
      }
    );

    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Drake command error:", error);
    await bot.sendMessage(
      chatId,
      "⚠️ Failed to create Drake meme. Started from the bottom and still here..."
    );
  }
  break;
}
case "meme": {
  const chatId = msg.chat.id;
  const args = msg.text.split(" ").slice(1);
  
  // Extract image and text (supports format: /meme <image> <text>)
  const [memeImage, ...textParts] = args;
  const memeText = textParts.join(" ");

  if (!memeImage || !memeText) {
    return bot.sendMessage(
      chatId,
      "🖼️ *Custom Meme Generator* 🖼️\n\n" +
      "Usage: /meme <template> <text>\n\n" +
      "Available Templates:\n" +
      "• drake\n" + 
      "• oogway\n" +
      "• sadcat\n" +
      "• clown\n" +
      "• wojak\n\n" +
      "Example: /meme clown me when I find a bug\n\n" +
      "👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n" +
      "⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
      { parse_mode: "Markdown" }
    );
  }

  try {
    const loadingMsg = await bot.sendMessage(
      chatId,
      "⏳ Generating your custom meme...",
      { parse_mode: "Markdown" }
    );

    const encodedText = encodeURIComponent(memeText);
    const imageUrl = `https://api.popcat.xyz/v2/${memeImage}?text=${encodedText}`;

    await bot.sendPhoto(
      chatId,
      imageUrl,
      {
        caption: `🖼️ ${memeText}\n\n` +
                 `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
                 `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        parse_mode: "Markdown"
      }
    );

    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error("Meme command error:", error);
    await bot.sendMessage(
      chatId,
      "⚠️ Failed to generate meme. Check your template name or try again later."
    );
  }
  break;
}
case "clown": 
case "wojak": {
  const chatId = msg.chat.id;
  const memeType = msg.text.startsWith('/clown') ? 'clown' : 'wojak';
  const args = msg.text.split(" ").slice(1);
  const text = args.join(" ").trim();

  if (!text) {
    const examples = {
      clown: "me when my code works first try",
      wojak: "me debugging at 3am"
    };
    
    return bot.sendMessage(
      chatId,
      `🎭 *${memeType.charAt(0).toUpperCase() + memeType.slice(1)} Meme Generator* 🎭\n\n` +
      `Usage: /${memeType} <your text>\n` +
      `Example: /${memeType} ${examples[memeType]}\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }

  try {
    const loadingMessages = {
      clown: "🤡 Painting your clown face...",
      wojak: "😩 Drawing wojak tears..."
    };
    
    const loadingMsg = await bot.sendMessage(
      chatId, 
      loadingMessages[memeType],
      { parse_mode: "Markdown" }
    );

    const encodedText = encodeURIComponent(text);
    const imageUrl = `https://api.popcat.xyz/v2/${memeType}?text=${encodedText}`;

    const captions = {
      clown: `🤡 ${text}`,
      wojak: `😩 ${text}`
    };

    await bot.sendPhoto(
      chatId,
      imageUrl,
      {
        caption: `${captions[memeType]}\n\n` +
                 `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
                 `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        parse_mode: "Markdown"
      }
    );

    await bot.deleteMessage(chatId, loadingMsg.message_id);
  } catch (error) {
    console.error(`${memeType} command error:`, error);
    const errorMessages = {
      clown: "⚠️ Honk honk! Clown generation failed.",
      wojak: "⚠️ Couldn't summon wojak tears. Try again."
    };
    await bot.sendMessage(chatId, errorMessages[memeType]);
  }
  break;
}

//DONE CODE BY DEEPSEEK 
  case "ai": {
  try {
    const chatId = msg.chat.id;
    const args = msg.text.split(" ").slice(1);
    const userQuery = args.join(" ").trim();

    if (!userQuery) {
      return bot.sendMessage(
        chatId,
        `🤖 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊* 🤖\n\n` +
        `Ask me anything! For example:\n` +
        `/ai Explain quantum computing\n` +
        `/ai Tell me a joke\n\n` +
        `👑  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        { parse_mode: "Markdown" }
      );
    }

    // Show typing indicator
    await bot.sendChatAction(chatId, "typing");

    // Send thinking message with cool animation
    const thinkingMsg = await bot.sendMessage(
      chatId,
      `🌀 *Activating Neural Networks* 🌀\n\n` +
      `▰▱▱▱▱▱▱▱▱▱ 20%\n` +
      `Processing your request...`,
      { parse_mode: "Markdown" }
    );

    // Simulate thinking animation
    for (let i = 40; i <= 100; i += 20) {
      await new Promise(resolve => setTimeout(resolve, 300));
      await bot.editMessageText(
        `🌀 *Activating Neural Networks* 🌀\n\n` +
        `${'▰'.repeat(i/10)}${'▱'.repeat(10-(i/10))} ${i}%\n` +
        `${i < 80 ? 'Analyzing knowledge base...' : 'Finalizing response...'}`,
        {
          chat_id: chatId,
          message_id: thinkingMsg.message_id,
          parse_mode: "Markdown"
        }
      );
    }

    // Fetch AI response
    const apiUrl = `https://api.siputzx.my.id/api/ai/blackboxai-pro?content=${encodeURIComponent(userQuery)}`;
    const response = await fetch(apiUrl);
    const jsonData = await response.json();

    if (!jsonData.status || !jsonData.data) {
      throw new Error('Invalid API response');
    }

    // Clean and format response
    const cleanResponse = jsonData.data
      .replace(/<think>\n\n<\/think>/g, '')
      .trim();

    // Create stylish response
    const aiResponse = `✨ *Queen Ruva AI Response* ✨\n\n` +
                      `▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                      `${cleanResponse}\n` +
                      `▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                      `💡 *Question:* "${userQuery}"\n\n` +
                      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
                      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`;

    // Edit original message with response
    await bot.editMessageText(
      aiResponse,
      {
        chat_id: chatId,
        message_id: thinkingMsg.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "🔁 Ask Another Question",
              callback_data: "ai_newquestion"
            }],
            [{
              text: "📚 Learn More",
              url: "https://t.me/kinetech06"
            }]
          ]
        }
      }
    );

    // Callback handlers
    bot.on('callback_query', async (callbackQuery) => {
      if (callbackQuery.data === "ai_newquestion") {
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.sendMessage(
          callbackQuery.message.chat.id,
          `💭 *New Question Prompt*\n\n` +
          `What would you like to ask next?\n` +
          `Just type /ai followed by your question\n\n` +
          `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
          `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
          { parse_mode: "Markdown" }
        );
      }
    });

  } catch (error) {
    console.error("AI command error:", error);
    await bot.sendMessage(
      chatId,
      `⚠️ *Neural Network Overload* ⚠️\n\n` +
      `Queen Ruva AI is currently busy\n` +
      `Please try again in a moment\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
  case "openai": {
  try {
    const chatId = msg.chat.id;
    const args = msg.text.split(" ").slice(1);
    const userQuery = args.join(" ").trim();

    if (!userQuery) {
      return bot.sendMessage(
        chatId,
        `🧠 *Advanced AI Query* 🧠\n\n` +
        `Usage: /openai <your question>\n` +
        `Example: /openai Explain quantum entanglement\n\n` +
        `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
        `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        { parse_mode: "Markdown" }
      );
    }

    // Show processing animation
    const processingMsg = await bot.sendMessage(
      chatId,
      `⚡ *Processing Your Query* ⚡\n\n` +
      `▰▱▱▱▱▱▱▱▱▱ 25%\n` +
      `Accessing advanced AI models...`,
      { parse_mode: "Markdown" }
    );

    // Animate processing
    for (let i = 45; i <= 100; i += 20) {
      await new Promise(resolve => setTimeout(resolve, 300));
      await bot.editMessageText(
        `⚡ *Processing Your Query* ⚡\n\n` +
        `${'▰'.repeat(i/10)}${'▱'.repeat(10-(i/10))} ${i}%\n` +
        `${i < 80 ? 'Analyzing knowledge graphs...' : 'Finalizing response...'}`,
        {
          chat_id: chatId,
          message_id: processingMsg.message_id,
          parse_mode: "Markdown"
        }
      );
    }

    // Fetch AI response
    const response = await fetch(`https://api.siputzx.my.id/api/ai/dbrx-instruct?content=${encodeURIComponent(userQuery)}`);
    const data = await response.json();

    if (!data?.status || !data.data) {
      throw new Error('Invalid API response');
    }

    // Format response
    const aiResponse = `✨ *Advanced AI Response* ✨\n\n` +
                      `▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                      `${data.data.trim()}\n` +
                      `▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                      `💭 *Your Query:* "${userQuery}"\n\n` +
                      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
                      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`;

    // Send final response
    await bot.editMessageText(
      aiResponse,
      {
        chat_id: chatId,
        message_id: processingMsg.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "🔍 Follow-up Question",
              callback_data: `openai_followup_${encodeURIComponent(userQuery)}`
            }],
            [{
              text: "📚 Learn More",
              url: "https://t.me/kinetech06"
            }]
          ]
        }
      }
    );

    // Callback handler
    bot.on('callback_query', async (callbackQuery) => {
      if (callbackQuery.data.startsWith('openai_followup_')) {
        const originalQuery = decodeURIComponent(callbackQuery.data.split('_')[2]);
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.sendMessage(
          callbackQuery.message.chat.id,
          `💭 *Follow-up to:* "${originalQuery}"\n\n` +
          `What would you like to ask next?\n` +
          `Just type /openai followed by your question\n\n` +
          `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
          `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
          { parse_mode: "Markdown" }
        );
      }
    });

  } catch (error) {
    console.error("OpenAI command error:", error);
    await bot.sendMessage(
      chatId,
      `⚠️ *AI Model Overload* ⚠️\n\n` +
      `Our advanced models are currently busy\n` +
      `Please try again in a moment\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
case "lyrics": {
  try {
    const chatId = msg.chat.id;
    const args = msg.text.split(" ").slice(1);
    const userQuery = args.join(" ").trim();

    // Help section
    if (!userQuery.includes("|")) {
      return bot.sendMessage(
        chatId,
        `🎵 *Queen Ruva Lyrics Finder* 🎵\n\n` +
        `🔍 *Format:* \`/lyrics Song | Artist\`\n\n` +
        `🌠 *Examples:*\n` +
        `• \`/lyrics Bohemian Rhapsody | Queen\`\n` +
        `• \`/lyrics Blinding Lights | The Weeknd\`\n\n` +
        `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
        `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{
                text: "🎧 Popular Examples",
                callback_data: "lyrics_examples"
              }]
            ]
          }
        }
      );
    }

    // Parse song and artist with validation
    const [songTitle, artist] = userQuery.split("|").map(s => s.trim());
    if (!songTitle || !artist) {
      return bot.sendMessage(
        chatId,
        `⚠️ *Invalid Format*\n\n` +
        `Use: \`/lyrics Song | Artist\`\n\n` +
        `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
        `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        { parse_mode: "Markdown" }
      );
    }

    // Log the search query
    console.log(`Lyrics search: ${songTitle} | ${artist}`);

    // Animated loading
    const loadingMsg = await bot.sendMessage(
      chatId,
      `🔍 *Searching for "${songTitle}"* 🔍\n\n` +
      `▰▱▱▱▱▱▱▱▱▱ 25%\n` +
      `Artist: ${artist}\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*`,
      { parse_mode: "Markdown" }
    );

    // Simulate loading
    for (let i = 45; i <= 100; i += 20) {
      await new Promise(resolve => setTimeout(resolve, 300));
      await bot.editMessageText(
        `🔍 *Searching for "${songTitle}"* 🔍\n\n` +
        `${'▰'.repeat(i/10)}${'▱'.repeat(10-(i/10))} ${i}%\n` +
        `${i < 80 ? 'Scanning databases...' : 'Finalizing lyrics...'}\n\n` +
        `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
          parse_mode: "Markdown"
        }
      );
    }

    // Try primary API
    let lyricsText;
    try {
      const response = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(songTitle)}`);
      if (!response.ok) throw new Error('Primary API failed');
      const data = await response.json();
      
      lyricsText = `🎤 *${songTitle}* — *${artist}* 🎤\n\n` +
                 `▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                 `${data.lyrics || "Lyrics unavailable for this track."}\n` +
                 `▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                 `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
                 `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`;
    } catch (primaryError) {
      console.log("Primary API failed, trying backup...");
      // Backup API attempt would go here
      throw new Error('All lyric sources failed');
    }

    // Send lyrics (split if too long)
    await bot.editMessageText(
      lyricsText.substring(0, 4000),
      {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "🔍 New Search",
              callback_data: "lyrics_new"
            }],
            [{
              text: "📚 More Commands",
              url: "https://t.me/yourchannel"
            }]
          ]
        }
      }
    );

  } catch (error) {
    console.error("Lyrics error:", error);
    
    // Safely extract song/artist even if parsing failed
    let errorSong = "this song", errorArtist = "this artist";
    try {
      const parts = userQuery.split("|").map(s => s.trim());
      if (parts.length >= 2) {
        errorSong = `"${parts[0]}"` || errorSong;
        errorArtist = parts[1] || errorArtist;
      }
    } catch (e) {}

    await bot.sendMessage(
      chatId,
      `❌ *Lyrics Not Found*\n\n` +
      `Couldn't find ${errorSong} by ${errorArtist}\n` +
      `• Check spelling (e.g., "Oman Lay" vs "Omah Lay")\n` +
      `• Try alternate artist names\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
case "llama": {
  const chatId = msg.chat.id;
  const userQuery = msg.text.split(" ").slice(1).join(" ").trim();

  if (!userQuery) {
    bot.sendMessage(chatId, "Please provide a query or question after 'llama'. For example: `llama How does machine learning work?`");
    return;
  }

  try {
    const response = await fetch(`https://apis.davidcyriltech.my.id/ai/llama3?text=${encodeURIComponent(userQuery)}`);
    const data = await response.json();
    console.log("API Response:", data);

    // Check if the response matches the structure from the screenshot
    if (data && data.creator && data.success && data.message) {
      bot.sendMessage(chatId, data.message);
    } else {
      console.error("Unexpected API response format:", data);
      bot.sendMessage(chatId, "Sorry, I couldn't get a proper response for your query.");
    }
  } catch (error) {
    console.error("Error processing request:", error);
    bot.sendMessage(chatId, "There was an error processing your request. Please try again later.");
  }
  break;
}
case "poll": {
  try {
    // Check if in group
    if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
      return bot.sendMessage(
        msg.chat.id,
        `👑 *Royal Poll System* 👑\n\n` +
        `This feature works only in groups!\n` +
        `Add me to your group to create polls.\n\n` +
        `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        { parse_mode: "Markdown" }
      );
    }

    // Check admin status
    const admins = await bot.getChatAdministrators(msg.chat.id);
    const isAdmin = admins.some(admin => admin.user.id === msg.from.id);
    
    if (!isAdmin) {
      return bot.sendMessage(
        msg.chat.id,
        `⚠️ *Royal Decree* ⚠️\n\n` +
        `Only group admins can create polls!\n` +
        `Ask your admin to setup this poll.\n\n` +
        `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
        `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        { parse_mode: "Markdown" }
      );
    }

    // Extract poll details
    const pollText = msg.text.split("/poll ")[1];
    
    if (!pollText || !pollText.includes("?")) {
      return bot.sendMessage(
        msg.chat.id,
        `📊 *Poll Creation Guide* 📊\n\n` +
        `Usage: /poll Question? Option1, Option2, Option3\n\n` +
        `✨ *Example:*\n` +
        `\`/poll Best Music Genre? Pop, Hip-Hop, Rock, Jazz\`\n\n` +
        `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
        `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        { parse_mode: "Markdown" }
      );
    }

    const [pollQuestion, optionsText] = pollText.split("?");
    const pollOptions = optionsText.split(",").map(option => option.trim()).filter(option => option.length > 0);

    if (pollOptions.length < 2) {
      return bot.sendMessage(
        msg.chat.id,
        `❌ *Poll Error* ❌\n\n` +
        `You need at least 2 options!\n` +
        `Example: \`Option1, Option2, Option3\`\n\n` +
        `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
        `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        { parse_mode: "Markdown" }
      );
    }

    // Create poll with stylish options
    await bot.sendPoll(
      msg.chat.id,
      `📊 ${pollQuestion.trim()} 👑`, // Question with crown emoji
      pollOptions,
      {
        is_anonymous: false,
        allows_multiple_answers: false,
        reply_markup: {
          inline_keyboard: [
            [{
              text: "📈 View Results",
              callback_data: "poll_results"
            }],
            [{
              text: "🔄 Create New Poll",
              callback_data: "new_poll"
            }]
          ]
        }
      }
    );

    // Callback handlers
    bot.on('callback_query', async (callbackQuery) => {
      if (callbackQuery.data === "poll_results") {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: "Poll results will appear when voting ends",
          show_alert: false
        });
      }
      else if (callbackQuery.data === "new_poll") {
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.sendMessage(
          callbackQuery.message.chat.id,
          `✨ *New Poll Setup* ✨\n\n` +
          `Type: \`/poll Question? Option1, Option2\`\n\n` +
          `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
          `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
          { parse_mode: "Markdown" }
        );
      }
    });

  } catch (error) {
    console.error("Poll command error:", error);
    await bot.sendMessage(
      msg.chat.id,
      `⚠️ *Royal Poll Error* ⚠️\n\n` +
      `The royal scribes failed to create your poll!\n` +
      `Please try again later.\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
case "setdesc": {
  // Check if the message is from a group
  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    bot.sendMessage(msg.chat.id, "❌ This command only works in groups.");
    return;
  }

  // Check if the user is an admin
  const admins = await bot.getChatAdministrators(msg.chat.id);
  const isAdmin = admins.some(admin => admin.user.id === msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "❌ Only admins can set the group description.");
    return;
  }

  // Check if a description is provided
  const args = msg.text.split(" ");
  const description = args.slice(1).join(" ");
  if (description.length === 0) {
    bot.sendMessage(msg.chat.id, "❌ Please provide a description for the group.");
    return;
  }

  try {
    // Set the group description
    await bot.setChatDescription(msg.chat.id, description);
    bot.sendMessage(msg.chat.id, `✅ Group description has been updated to: ${description}`);
  } catch (error) {
    console.log("Error setting group description:", error);
    bot.sendMessage(msg.chat.id, "❌ Unable to set the group description.");
  }
}
break;
case "wyr": {
  try {
    // Show loading animation
    const loadingMsg = await bot.sendMessage(
      msg.chat.id,
      `🤔 *Preparing Dilemma* 🤔\n\n` +
      `▰▱▱▱▱▱▱▱▱▱ 20%\n` +
      `Consulting the Oracle of Choices...`,
      { parse_mode: "Markdown" }
    );

    // Animate loading
    for (let i = 40; i <= 100; i += 20) {
      await new Promise(resolve => setTimeout(resolve, 300));
      await bot.editMessageText(
        `🤔 *Preparing Dilemma* 🤔\n\n` +
        `${'▰'.repeat(i/10)}${'▱'.repeat(10-(i/10))} ${i}%\n` +
        `${i < 80 ? 'Weighing moral consequences...' : 'Finalizing your fate...'}`,
        {
          chat_id: msg.chat.id,
          message_id: loadingMsg.message_id,
          parse_mode: "Markdown"
        }
      );
    }

    // Fetch WYR question
    const response = await fetch("https://api.popcat.xyz/wyr");
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const { ops1, ops2 } = await response.json();

    // Create poll-style message
    await bot.editMessageText(
      `👑 *Queen Ruva's Dilemma* 👑\n\n` +
      `🔥 *WOULD YOU RATHER...*\n\n` +
      `▬▬▬▬▬▬▬▬▬▬▬▬\n` +
      `1️⃣ ${ops1}\n\n` +
      `*OR*\n\n` +
      `2️⃣ ${ops2}\n` +
      `▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
      `Reply with 1 or 2 to cast your vote!\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      {
        chat_id: msg.chat.id,
        message_id: loadingMsg.message_id,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "1️⃣ Choose Option 1",
              callback_data: "wyr_1"
            }],
            [{
              text: "2️⃣ Choose Option 2",
              callback_data: "wyr_2"
            }],
            [{
              text: "🔄 New Dilemma",
              callback_data: "wyr_new"
            }]
          ]
        }
      }
    );

    // Callback handlers
    bot.on('callback_query', async (callbackQuery) => {
      const choice = callbackQuery.data.split('_')[1];
      
      if (choice === "1" || choice === "2") {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: `You chose option ${choice}!`,
          show_alert: false
        });
        
        // Send reaction based on choice
        const reaction = choice === "1" ? "👈" : "👉";
        await bot.sendMessage(
          callbackQuery.message.chat.id,
          `${reaction} *Interesting choice!* ${reaction}\n\n` +
          `"${choice === "1" ? ops1 : ops2}"\n\n` +
          `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
          `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
          { parse_mode: "Markdown" }
        );
      }
      else if (callbackQuery.data === "wyr_new") {
        await bot.answerCallbackQuery(callbackQuery.id);
        // Trigger new WYR question
        bot.sendMessage(msg.chat.id, "/wyr", { parse_mode: "Markdown" });
      }
    });

  } catch (error) {
    console.error("WYR command error:", error);
    await bot.sendMessage(
      msg.chat.id,
      `⚠️ *Dilemma Engine Failure* ⚠️\n\n` +
      `The Oracle of Choices is unavailable!\n` +
      `Try again later...\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}

case "ssweb": {
  try {
    const args = msg.text.split(" ").slice(1);
    const url = args[0];

    // Check if URL is provided
    if (!url) {
      return bot.sendMessage(
        msg.chat.id,
        `🌐 *Website Screenshot* 🌐\n\n` +
        `Usage: /ssweb <website-url>\n` +
        `Example: /ssweb https://google.com\n\n` +
        `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
        `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [{
                text: "🌍 Try Example",
                callback_data: "ssweb_example"
              }]
            ]
          }
        }
      );
    }

    // Show processing animation
    const processingMsg = await bot.sendMessage(
      msg.chat.id,
      `📸 *Capturing Website* 📸\n\n` +
      `▰▱▱▱▱▱▱▱▱▱ 25%\n` +
      `Initializing royal screenshot...`,
      { parse_mode: "Markdown" }
    );

    // Animate processing
    for (let i = 45; i <= 100; i += 20) {
      await new Promise(resolve => setTimeout(resolve, 300));
      await bot.editMessageText(
        `📸 *Capturing Website* 📸\n\n` +
        `${'▰'.repeat(i/10)}${'▱'.repeat(10-(i/10))} ${i}%\n` +
        `${i < 80 ? 'Rendering page elements...' : 'Finalizing image...'}`,
        {
          chat_id: msg.chat.id,
          message_id: processingMsg.message_id,
          parse_mode: "Markdown"
        }
      );
    }

    // Format URL
    const formattedUrl = url.startsWith("http") ? url : `https://${url}`;
    const screenshotUrl = `https://image.thum.io/get/width/1900/crop/1000/fullpage/noanimate/${formattedUrl}`;

    // Send screenshot with interactive buttons
    await bot.sendPhoto(
      msg.chat.id,
      screenshotUrl,
      {
        caption: `🖥️ *Website Screenshot* 🖥️\n\n` +
                 `▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                 `🌐 ${formattedUrl}\n` +
                 `▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                 `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
                 `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "🔄 Capture Again",
              callback_data: `ssweb_reload_${encodeURIComponent(formattedUrl)}`
            }],
            [{
              text: "🌍 Visit Website",
              url: formattedUrl
            }]
          ]
        }
      }
    );

    // Delete processing message
    await bot.deleteMessage(msg.chat.id, processingMsg.message_id);

  } catch (error) {
    console.error("Screenshot Error:", error);
    await bot.sendMessage(
      msg.chat.id,
      `⚠️ *Capture Failed* ⚠️\n\n` +
      `Couldn't screenshot the website:\n` +
      `• Check URL format (include https://)\n` +
      `• Site may block screenshots\n` +
      `• Try again later\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }

  // Callback handlers
  bot.on('callback_query', async (callbackQuery) => {
    const [action, data] = callbackQuery.data.split('_');
    
    if (action === "ssweb" && data === "example") {
      await bot.answerCallbackQuery(callbackQuery.id);
      await bot.sendMessage(
        callbackQuery.message.chat.id,
        "/ssweb https://google.com",
        { parse_mode: "Markdown" }
      );
    }
    else if (action === "ssweb" && data.startsWith("reload")) {
      const url = decodeURIComponent(callbackQuery.data.split('_')[2]);
      await bot.answerCallbackQuery(callbackQuery.id, { text: "Recapturing website...", show_alert: false });
      await bot.sendMessage(
        callbackQuery.message.chat.id,
        `/ssweb ${url}`,
        { parse_mode: "Markdown" }
      );
    }
  });
  break;
}
case "pairing": {
    try {
        const { chat, from, text } = msg;
        const chatId = chat.id;
        
        // Extract number from command
        const userNumber = text.split(" ")[1];
        if (!userNumber) {
            return bot.sendMessage(
                chatId,
                `📱 *WhatsApp Pairing*\n\n` +
                `Please provide your WhatsApp number:\n` +
                `\`/pairing 1234567890\`\n\n` +
                `Example: \`/pairing 15551234567\` (with country code)`,
                { parse_mode: "Markdown" }
            );
        }

        // Validate number
        const cleanNumber = userNumber.replace(/[^0-9]/g, '');
        if (cleanNumber.length < 8) {
            return bot.sendMessage(
                chatId,
                "❌ Invalid number format. Include country code (e.g. 14151234567)",
                { parse_mode: "Markdown" }
            );
        }

        // Start pairing process
        const loadingMsg = await bot.sendMessage(
            chatId,
            `⚙️ Generating pairing code for ${cleanNumber}...`,
            { parse_mode: "Markdown" }
        );

        // Initialize WhatsApp connection directly
        const { state, saveCreds } = await useMultiFileAuthState(`./session_${from.id}`);
        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino()),
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" })
        });

        // Request pairing code
        if (!sock.authState.creds.registered) {
            const pairingCode = await sock.requestPairingCode(cleanNumber);
            
            // Send code to user
            await bot.editMessageText(
                `✅ *Pairing Code Generated*\n\n` +
                `🔢 Code: \`${pairingCode}\`\n\n` +
                `1. Open WhatsApp → Linked Devices\n` +
                `2. Tap "Link a Device"\n` +
                `3. Enter this code`,
                {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id,
                    parse_mode: "Markdown"
                }
            );

            // Listen for connection updates
            sock.ev.on("connection.update", async (update) => {
                if (update.connection === "open") {
                    // Connection successful - send creds.json
                    const creds = fs.readFileSync(`./session_${from.id}/creds.json`);
                    
                    await bot.sendDocument(
                        chatId,
                        creds,
                        {},
                        {
                            filename: "creds.json",
                            contentType: "application/json"
                        }
                    );
                    
                    await bot.sendMessage(
                        chatId,
                        `🔐 *Pairing Complete!*\n\n` +
                        `Your credentials file has been sent.\n` +
                        `⚠️ Keep this file secure!`,
                        { parse_mode: "Markdown" }
                    );

                    // Cleanup
                    sock.end();
                    fs.rmSync(`./session_${from.id}`, { recursive: true });
                }
            });

            // Save credentials when updated
            sock.ev.on("creds.update", saveCreds);
        }

    } catch (error) {
        console.error("Pairing error:", error);
        bot.sendMessage(
            chatId,
            `❌ Pairing failed: ${error.message}\n\n` +
            `Please try again later.`,
            { parse_mode: "Markdown" }
        );
    }
    break;
}
case "mutegroup": {
  // Check if the message is from a group
  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    bot.sendMessage(msg.chat.id, "❌ This command only works in groups.");
    return;
  }

  // Check if the user is an admin
  const admins = await bot.getChatAdministrators(msg.chat.id);
  const isAdmin = admins.some(admin => admin.user.id === msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "❌ Only admins can mute the group.");
    return;
  }

  try {
    // Restrict all members in the group from sending messages
    await bot.restrictChatMember(msg.chat.id, msg.from.id, {
      permissions: { can_send_messages: false }
    });

    bot.sendMessage(msg.chat.id, "🔇 The group has been muted. Users cannot send messages until unmuted.");
  } catch (error) {
    console.log("Error muting the group:", error);
    bot.sendMessage(msg.chat.id, "❌ Failed to mute the group. Make sure I have admin permissions.");
  }
}
break;
case "unmutegroup": {
  // Check if the message is from a group
  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    bot.sendMessage(msg.chat.id, "❌ This command only works in groups.");
    return;
  }

  // Check if the user is an admin
  const admins = await bot.getChatAdministrators(msg.chat.id);
  const isAdmin = admins.some(admin => admin.user.id === msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "❌ Only admins can unmute the group.");
    return;
  }

  try {
    // Unmute all members in the group
    await bot.restrictChatMember(msg.chat.id, msg.from.id, {
      permissions: { can_send_messages: true }
    });

    bot.sendMessage(msg.chat.id, "✅ The group has been unmuted. All members can send messages again.");
  } catch (error) {
    console.log("Error unmuting the group:", error);
    bot.sendMessage(msg.chat.id, "❌ Failed to unmute the group. Make sure I have admin permissions.");
  }
}
break;
case "pin": {
  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    bot.sendMessage(msg.chat.id, "❌ This command only works in groups.");
    return;
  }

  // Check if the user issuing the command is an admin
  const admins = await bot.getChatAdministrators(msg.chat.id);
  const isAdmin = admins.some(admin => admin.user.id === msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "❌ Only admins can pin messages.");
    return;
  }

  if (msg.reply_to_message) {
    try {
      await bot.pinChatMessage(msg.chat.id, msg.reply_to_message.message_id);
      bot.sendMessage(msg.chat.id, "✅ The message has been pinned.");
    } catch (error) {
      console.log("Error pinning the message:", error);
      bot.sendMessage(msg.chat.id, "❌ Failed to pin the message.");
    }
  } else {
    bot.sendMessage(msg.chat.id, "❌ Please reply to a message to pin it.");
  }
}
break;
case "unpin": {
  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    bot.sendMessage(msg.chat.id, "❌ This command only works in groups.");
    return;
  }

  // Check if the user issuing the command is an admin
  const admins = await bot.getChatAdministrators(msg.chat.id);
  const isAdmin = admins.some(admin => admin.user.id === msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "❌ Only admins can unpin messages.");
    return;
  }

  try {
    // Attempt to unpin the currently pinned message
    await bot.unpinChatMessage(msg.chat.id);
    bot.sendMessage(msg.chat.id, "✅ The pinned message has been unpinned.");
  } catch (error) {
    console.log("Error unpinning the message:", error);
    bot.sendMessage(msg.chat.id, "❌ Failed to unpin the message.");
  }
}
break;
case "clearchat": {
  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    bot.sendMessage(msg.chat.id, "❌ This command only works in groups.");
    return;
  }

  // Check if the user issuing the command is an admin
  const admins = await bot.getChatAdministrators(msg.chat.id);
  const isAdmin = admins.some(admin => admin.user.id === msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "❌ Only admins can clear the chat.");
    return;
  }

  try {
    // Delete all messages in the group
    await bot.deleteMessages(msg.chat.id, { until_date: Date.now() / 1000 });
    bot.sendMessage(msg.chat.id, "✅ All messages in the chat have been cleared.");
  } catch (error) {
    console.log("Error clearing chat:", error);
    bot.sendMessage(msg.chat.id, "❌ Failed to clear the chat.");
  }
}
break;
case "setrules": {
  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    bot.sendMessage(msg.chat.id, "❌ This command only works in groups.");
    return;
  }

  // Check if the user issuing the command is an admin
  const admins = await bot.getChatAdministrators(msg.chat.id);
  const isAdmin = admins.some(admin => admin.user.id === msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "❌ Only admins can set rules.");
    return;
  }

  const rules = msg.text.slice("/setrules ".length);
  if (!rules) {
    bot.sendMessage(msg.chat.id, "❌ Please provide the rules for the group.");
    return;
  }

  // Save the rules (could use a database or in-memory storage for persistence)
  bot.rules = rules;
  bot.sendMessage(msg.chat.id, `✅ The rules have been set: "${rules}"`);
}
break;
case "rules": {
  if (!bot.rules) {
    bot.sendMessage(msg.chat.id, "❌ No rules have been set for this group.");
    return;
  }
  bot.sendMessage(msg.chat.id, `📜 Group Rules:\n${bot.rules}`);
}
break;

case "clearall": {
  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    bot.sendMessage(msg.chat.id, "❌ This command only works in groups.");
    return;
  }

  // Check if the user issuing the command is an admin
  const admins = await bot.getChatAdministrators(msg.chat.id);
  const isAdmin = admins.some(admin => admin.user.id === msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "❌ Only admins can clear messages.");
    return;
  }

  try {
    // This will clear all messages in the group, if the bot has permission
    await bot.deleteMessages(msg.chat.id);
    bot.sendMessage(msg.chat.id, "✅ All messages have been deleted.");
  } catch (error) {
    console.log("Error clearing messages:", error);
    bot.sendMessage(msg.chat.id, "❌ Failed to clear messages. Make sure I have admin permissions.");
  }
}
break;
case "promote": {
  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    bot.sendMessage(msg.chat.id, "❌ This command only works in groups.");
    return;
  }

  // Check if the user issuing the command is an admin
  const admins = await bot.getChatAdministrators(msg.chat.id);
  const isAdmin = admins.some(admin => admin.user.id === msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "❌ Only admins can promote users.");
    return;
  }

  if (msg.reply_to_message) {
    const userIdToPromote = msg.reply_to_message.from.id;
    try {
      await bot.promoteChatMember(msg.chat.id, userIdToPromote, { can_change_info: true, can_post_messages: true, can_edit_messages: true, can_delete_messages: true, can_invite_to_group: true, can_restrict_members: true });
      bot.sendMessage(msg.chat.id, "✅ The user has been promoted to an admin.");
    } catch (error) {
      console.log("Error promoting the user:", error);
      bot.sendMessage(msg.chat.id, "❌ Failed to promote the user.");
    }
  } else {
    bot.sendMessage(msg.chat.id, "❌ Please reply to the user's message to promote them.");
  }
}
break;
case "delete":
{
  const chatId = msg.chat.id;
  if (msg.reply_to_message) {
    const messageId = msg.reply_to_message.message_id;

    // Send a message confirming deletion
    bot.sendMessage(chatId, "🗑️ The message will be deleted shortly...").then((deleteMessage) => {
      const deleteMessageId = deleteMessage.message_id;

      // Delete the message after 2 seconds
      setTimeout(() => {
        bot.deleteMessage(chatId, messageId).then(() => {
          bot.sendMessage(chatId, "✅ The message has been deleted.").then((finalMessage) => {
            const finalMessageId = finalMessage.message_id;

            // Delete the previous "🗑️ The message will be deleted shortly..." after showing it
            setTimeout(() => {
              bot.deleteMessage(chatId, deleteMessageId);
            }, 2000);

            // Send the bot name message after the deletion is done
            bot.sendMessage(chatId, "👑 𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 Developer Iconic Tech", {
              reply_markup: {}
            }).then((botMessage) => {
              const botMessageId = botMessage.message_id;

              // Delete the "👑 𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 Developer Iconic Tech" message after showing it
              setTimeout(() => {
                bot.deleteMessage(chatId, botMessageId);
              }, 2000);
            });
          });
        }).catch((err) => {
          bot.sendMessage(chatId, "❌ Failed to delete the message. " + err.message);
        });
      }, 2000);
    });
  } else {
    bot.sendMessage(chatId, "❓ Please reply to a message to delete it.");
  }
}
break;
case "setwelcome": {
  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    bot.sendMessage(msg.chat.id, "❌ This command only works in groups.");
    return;
  }

  // Check if the user issuing the command is an admin
  const admins = await bot.getChatAdministrators(msg.chat.id);
  const isAdmin = admins.some(admin => admin.user.id === msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "❌ Only admins can set a welcome message.");
    return;
  }

  const welcomeMessage = msg.text.slice("/setwelcome ".length);
  if (!welcomeMessage) {
    bot.sendMessage(msg.chat.id, "❌ Please provide a welcome message.");
    return;
  }

  // Save the welcome message (could use a database or in-memory storage for persistence)
  // Example: saving in-memory
  bot.welcomeMessage = welcomeMessage;
  bot.sendMessage(msg.chat.id, `✅ Welcome message set: "${welcomeMessage}"`);
}
break;
//this for bank of welcome handlll
bot.on('new_chat_members', async (msg) => {
  const newMember = msg.new_chat_members[0];

  // Check if there is a welcome message
  if (bot.welcomeMessage) {
    bot.sendMessage(msg.chat.id, `${bot.welcomeMessage}, @${newMember.username || newMember.first_name}!`);
  } else {
    bot.sendMessage(msg.chat.id, `Welcome to the group, @${newMember.username || newMember.first_name}!`);
  }
});
case "kick": 
case "ban":{
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    bot.sendMessage(msg.chat.id, "❌ Please add me to a group to unlock the features.");
    return;
  }

  // Check if the user issuing the command is an admin
  const admins = await bot.getChatAdministrators(msg.chat.id);
  const isAdmin = admins.some(admin => admin.user.id === msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "❌ Only admins can kick users.");
    return;
  }

  // Extract the user to kick (either a reply or mentioned username)
  let userIdToKick;
  
  if (msg.reply_to_message) {
    userIdToKick = msg.reply_to_message.from.id; // Kick the user from the replied message
  } else {
    const args = msg.text.split(" ");
    if (args.length < 2) {
      bot.sendMessage(msg.chat.id, "❌ Please reply to a user's message or mention them. Example: /kick @username");
      return;
    }
    
    const mentionedUser = args[1].replace("@", ""); // Remove @ from the username
    
    // Get user info from username
    try {
      const user = await bot.getChatMember(msg.chat.id, mentionedUser);
      userIdToKick = user.user.id;
    } catch (error) {
      bot.sendMessage(msg.chat.id, "❌ Unable to find the mentioned user.");
      return;
    }
  }

  // Ensure the bot is not trying to kick an admin
  const targetUser = await bot.getChatMember(msg.chat.id, userIdToKick);
  if (targetUser.status === "administrator" || targetUser.status === "creator") {
    bot.sendMessage(msg.chat.id, "❌ I cannot kick an admin.");
    return;
  }

  // Kick the user
  try {
    await bot.banChatMember(msg.chat.id, userIdToKick);
    bot.sendMessage(msg.chat.id, `👋 User has been kicked from the group.`);
  } catch (error) {
    console.log("Error kicking user:", error);
    bot.sendMessage(msg.chat.id, "❌ Failed to kick the user. Make sure I have admin permissions.");
  }
}
break;


case "add": {
  if (msg.chat.type !== "group" && msg.chat.type !== "supergroup") {
    bot.sendMessage(msg.chat.id, "❌ This command only works in groups.");
    return;
  }

  // Check if the user issuing the command is an admin
  const admins = await bot.getChatAdministrators(msg.chat.id);
  const isAdmin = admins.some(admin => admin.user.id === msg.from.id);
  if (!isAdmin) {
    bot.sendMessage(msg.chat.id, "❌ Only admins can invite users.");
    return;
  }

  try {
    const inviteLink = await bot.exportChatInviteLink(msg.chat.id);
    bot.sendMessage(msg.chat.id, `🔗 Send this link to invite users: ${inviteLink}`);
  } catch (error) {
    console.log("Error creating invite link:", error);
    bot.sendMessage(msg.chat.id, "❌ Unable to generate an invite link.");
  }
}
break;
case "grouprule": {
  // Check if the message is from a group chat or not
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    bot.sendMessage(msg.chat.id, "❌ Please add me to a group to unlock the features.");
    return;
  }

  try {
    // Fetch group info
    const chat = await bot.getChat(msg.chat.id);
    const groupName = chat.title;

    // Define custom group rules (You can customize this part)
    const groupRules = `
    📜 *Group Rules* for ${groupName}
    ─────────────────────
    1. Respect everyone in the group.
    2. No spamming or flooding messages.
    3. Keep discussions relevant to the group’s purpose.
    4. No offensive language or behavior.
    5. No sharing inappropriate content.
    6. Always follow the admin's instructions.
    7. Have fun and be friendly!
    ─────────────────────
    Please adhere to these rules to maintain a friendly environment.
    `;

    // Send the group rules message
    bot.sendMessage(msg.chat.id, groupRules);
  } catch (error) {
    console.log("Error fetching group rules:", error);
    bot.sendMessage(msg.chat.id, "❌ Unable to fetch group rules.");
  }
}
break;
case "groupinfo": {
  // Check if the message is from a group chat or not
  if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
    bot.sendMessage(msg.chat.id, "❌ Please add me to a group to unlock the features.");
    return;
  }

  try {
    // Fetch group info
    const chat = await bot.getChat(msg.chat.id);
    const groupName = chat.title;

    // Fetch total members
    const totalMembers = await bot.getChatMemberCount(msg.chat.id);

    // Fetch total admins
    const admins = await bot.getChatAdministrators(msg.chat.id);
    const totalAdmins = admins.length;

    // Get the user ID of the person who sent the command
    const userId = msg.from.id;

    // Bot owner's username or ID (Set your actual owner ID)
    const botOwner = "Iconic Tech"; // Change this if needed

    // Generate the group invite link
    const inviteLink = await bot.exportChatInviteLink(msg.chat.id);

    // Send the group info message
    bot.sendMessage(msg.chat.id, `📢 *Group Info*
━━━━━━━━━━━━━━━━━━
🏷 *Group Name:* ${groupName}
👥 *Total Members:* ${totalMembers}
🔰 *Total Admins:* ${totalAdmins}
👤 *Your User ID:* ${userId}
🤖 *Bot Developer:* ${botOwner}
🔗 *Group Invite Link:* ${inviteLink}
━━━━━━━━━━━━━━━━━━`);
  } catch (error) {
    console.log("Error fetching group info:", error);
    bot.sendMessage(msg.chat.id, "❌ Unable to fetch group info.");
  }
}
break;
  case "deepseek": {
  const chatId = msg.chat.id;

  // Check if the user provided a query after "chatgpt"
  const userQuery = msg.text.split(" ").slice(1).join(" ").trim(); // Extract the query after "chatgpt"

  if (!userQuery) {
    // If no query is provided, ask the user to include one
    bot.sendMessage(chatId, "Please provide a query or question after 'chatgpt'. For example: `chatgpt How are you?`");
    return; // Exit the function
  }

  // If a query is provided, proceed with the API request
  try {
    // API request to the AI
    const response = await fetch(`https://api.siputzx.my.id/api/ai/blackboxai-pro?content=${encodeURIComponent(userQuery)}`);
    const data = await response.json();
    console.log("API Response:", data); // Log the full response

    // Check if the response is valid
    if (data && data.status && data.data && typeof data.data === 'string') {
      const aiResponse = data.data;
      bot.sendMessage(chatId, aiResponse);
    } else {
      console.error("Unexpected API response format:", data);
      bot.sendMessage(chatId, "Sorry, I couldn't get a proper response for your query.");
    }
  } catch (error) {
    console.error("Error processing request:", error);
    bot.sendMessage(chatId, "There was an error processing your request. Please try again later.");
  }
  break;
}
case "getpp": {
  // Check if the message is a reply
  let userId;
  if (msg.reply_to_message) {
    // Use the replied user's ID
    userId = msg.reply_to_message.from.id;
  } else {
    // Use the sender's ID if it's not a reply
    userId = msg.from.id;
  }

  // Fetch the profile picture (platform-specific method)
  bot.getUserProfilePhotos(userId, { limit: 1 }) // Adjust this to your platform's method
    .then(photos => {
      if (photos.total_count > 0) {
        const fileId = photos.photos[0][0].file_id; // Get the file ID of the profile picture
        bot.sendPhoto(chatId, fileId) // Send the profile picture
          .then(() => {
            console.log(`Profile picture sent for user ${userId}`);
          })
          .catch(err => {
            console.error("Failed to send profile picture:", err);
            bot.sendMessage(chatId, "❌ Failed to send profile picture. Please try again.");
          });
      } else {
        bot.sendMessage(chatId, "❌ No profile picture found for this user.");
      }
    })
    .catch(err => {
      console.error("Error fetching profile picture:", err);
      bot.sendMessage(chatId, "❌ Error fetching profile picture. Please try again.");
    });
}
break;
case "join": {
  const args = msg.text.split(" ").slice(1); // Get the arguments after the command

  // Check if a link is provided
  if (args.length === 0) {
    return bot.sendMessage(chatId, "❌ Please provide an invite link.\nExample: /join https://example.com/invite-link");
  }

  const inviteLink = args[0]; // Get the invite link from the arguments

  // Validate the link (basic example, adjust as needed)
  if (!inviteLink.startsWith("http://") && !inviteLink.startsWith("https://")) {
    return bot.sendMessage(chatId, "❌ Invalid link. Please provide a valid invite link.");
  }

  // Log the join attempt for debugging
  console.log(`Attempting to join group/chat with link: ${inviteLink}`);

  // Check if the platform supports joining via invite link
  if (bot.joinChat) {
    // Use the platform-specific method to join the group/chat
    bot.joinChat(inviteLink) // Replace with the correct method for your platform
      .then(() => {
        bot.sendMessage(chatId, "✅ Successfully joined the group/chat!");
      })
      .catch(err => {
        console.error("Failed to join group/chat:", err);
        bot.sendMessage(chatId, "❌ Failed to join the group/chat. Please check the link and try again.");
      });
  } else {
    // If the platform does not support joining via link, provide instructions
    bot.sendMessage(
      chatId,
      `🚫 This platform does not support joining via invite links.\n\n` +
      `To add me to your group or chat, follow these steps:\n` +
      `1. Go to your group or chat settings.\n` +
      `2. Add me as a member using my username: @${bot.username}\n` +
      `3. Make sure I have the necessary permissions to function properly.`
    );
  }
}
break;
case "anime": {
  const chatId = msg.chat.id;
  const args = msg.text.split(" ").slice(1);
  const userQuery = args.join(" ").trim();

  if (!userQuery) {
    return bot.sendMessage(
      chatId,
      `🎌 *Anime Image Search* 🎌\n\n` +
      `Usage: /anime <search term>\n` +
      `Example: /anime naruto\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }

  try {
    // Show loading animation
    const loadingMsg = await bot.sendMessage(
      chatId,
      `🔍 *Searching Anime Images* 🔍\n\n` +
      `▰▱▱▱▱▱▱▱▱▱ 20%\n` +
      `Looking for "${userQuery}"...`,
      { parse_mode: "Markdown" }
    );

    // Fetch images
    const apiUrl = `https://img.hazex.workers.dev/?prompt=${encodeURIComponent(userQuery)}&anime=true`;
    const response = await fetch(apiUrl);
    
    if (!response.ok) throw new Error(`API error: ${response.status}`);

    // Send all 5 images directly
    let imagesSent = 0;
    for (let i = 1; i <= 5; i++) {
      try {
        const imageUrl = `${apiUrl}&index=${i}`;
        await bot.sendPhoto(
          chatId,
          imageUrl,
          {
            caption: `🖼️ Anime Image ${i} for "${userQuery}"\n\n` +
                     `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
                     `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
            parse_mode: "Markdown"
          }
        );
        imagesSent++;
        // Small delay between images to avoid rate limiting
        if (i < 5) await new Promise(resolve => setTimeout(resolve, 500));
      } catch (imageError) {
        console.error(`Error sending anime image ${i}:`, imageError);
        // Continue to next image if one fails
      }
    }

    if (imagesSent === 0) {
      throw new Error('No anime images could be sent');
    }

    // Final message showing completion
    await bot.sendMessage(
      chatId,
      `✅ Sent ${imagesSent} anime images for "${userQuery}"\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );

    await bot.deleteMessage(chatId, loadingMsg.message_id);

  } catch (error) {
    console.error("Anime command error:", error);
    await bot.sendMessage(
      chatId,
      `⚠️ *Anime Search Failed* ⚠️\n\n` +
      `Couldn't find anime images for "${userQuery}"\n` +
      `• Try different keywords\n` +
      `• Check your spelling\n` +
      `• The service might be temporarily unavailable\n\n` +
      `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
  case "userinfo":
{
  const chatId = msg.chat.id;
  const userName = msg.from.username || "No username"; // Get username or show "No username"
  const userFirstName = msg.from.first_name; // Get first name
  const userLastName = msg.from.last_name || "No last name"; // Get last name or show "No last name"
  
  bot.sendMessage(chatId, `👤 User Info:
  ╭───────────────────────────
  │ *Username:* ${userName}
  │ *First Name:* ${userFirstName}
  │ *Last Name:* ${userLastName}
  │ *Chat ID:* ${chatId}
  ╰───────────────────────────`);
}
break;
  case "info":
{
  const chatId = msg.chat.id;
  const userName = msg.chat.first_name || "Anonymous"; // Get user's first name
  const userId = msg.chat.id;  // Get the user's unique Telegram ID

  // Send the user their information
  bot.sendMessage(chatId, `🔍 *User Information:*
  ╭───────────────────────────
  │ *Name:* ${userName}
  │ *User ID:* ${userId}
  ╰───────────────────────────
  ᴄʀᴇᴀᴛᴏʀ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`);
}
break;
case "message": {
    try {
        // Random message generator
        const randomMessages = [
            {
                text: `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 Update* 👑\n\n` +
                      `We've heard your feedback!\n` +
                      `Our team at *Iconic Tech* is working on:\n` +
                      `• Enhanced video playback\n` +
                      `• we updated bot everyday don't forget to typ message to see notification \n` +
                      `• New fun commands\n\n` +
                      `Stay tuned for the next upgrade!\n\n` +
                      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
                options: {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{
                                text: "🔔 Join Updates Channel",
                                url: "https://t.me/iconictech_official"
                            }]
                        ]
                    }
                }
            },
            {
                text: `✨ *Thanks for typ message..this messages its for you queen ruva ai user s* ✨\n\n` +
                      `Thanks for using *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*!\n\n` +
                      `Recent improvements:\n` +
                      `• Fixed audio playback issues\n` +
                      `• Added  new response modes\n` +
                      `• Optimized bot performance\n\n` +
                      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
                options: {
                    parse_mode: "Markdown"
                }
            },
            {
                text: `🚀 *Coming Soon* 🚀\n\n` +
                      `*𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊* is getting:\n` +
                      `• new update its play and video.my team we work on it \n` +
                      `• don't forget to typ message for what we ADDED on our bot\n` +
                      `• 25/3/2025*\n\n` +
                      `Follow for more information\n\n` +
                      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
                options: {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{
                                text: "💌Join update chatroom",
                                url: "https://t.me/iconictech_official"
                            }],
                            [{
                                text: "Whatsapp Channel",
                                url: "https://whatsapp.com/channel/0029ValX2Js9RZAVtDgMYj0r"
                            }]
                        ]
                    }
                }
            }
        ];

        // Select random message
        const randomIndex = Math.floor(Math.random() * randomMessages.length);
        const selectedMessage = randomMessages[randomIndex];

        // Send message
        await bot.sendMessage(
            chatId,
            selectedMessage.text,
            selectedMessage.options
        );

        // Callback handlers
        bot.on('callback_query', async (callbackQuery) => {
            switch(callbackQuery.data) {
                case "vote_games":
                    await bot.answerCallbackQuery(callbackQuery.id, {
                        text: "Thanks for voting for game features!",
                        show_alert: false
                    });
                    break;
                
                case "vote_langs":
                    await bot.answerCallbackQuery(callbackQuery.id, {
                        text: "Language support coming soon!",
                        show_alert: false
                    });
                    break;
            }
        });

    } catch (error) {
        console.error("Message command error:", error);
        await bot.sendMessage(
            chatId,
            `❌ *Message System Error*\n\n` +
            `Our royal messengers are busy!\n` +
            `Try again later...\n\n` +
            `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
            `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
            { parse_mode: "Markdown" }
        );
    }
    break;
}
case "whatsapp": {
  try {
    await bot.sendMessage(
      chatId,
      `📲 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 - Now on WhatsApp!* 📲\n\n` +
      `✨ *To activate your AI experience:*\n` +
      `1. Save this number: *+263 78 611 5435*\n` +
      `2. Open WhatsApp and send:\n` +
      `   \`.menu\` (with the dot)\n\n` +
      `🚀 *Instant Access to:*\n` +
      `• Smart AI Assistant\n` +
      `• Quick Commands\n` +
      `• Premium Features\n\n` +
      `🔗 *One-Click Start:*`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "💬 Chat Now on WhatsApp",
              url: "https://wa.me/263786115435?text=.menu"
            }],
            [{
              text: "❓ Need Help?",
              callback_data: "whatsapp_help"
            }]
          ]
        }
      }
    );

    // Callback handler
    bot.on('callback_query', async (callbackQuery) => {
      if (callbackQuery.data === "whatsapp_help") {
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.sendMessage(
          callbackQuery.message.chat.id,
          `🛠️ *WhatsApp Bot Support*\n\n` +
          `Having trouble?\n\n` +
          `1. Ensure you saved the number\n` +
          `2. Type \`.menu\` exactly like this\n` +
          `3. Wait for the command list\n\n` +
          `Still stuck? Contact:\n` +
          `📞 +263 78 352 5824\n` +
          `📢 @IconicTechOfficial\n\n` +
          `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
          { parse_mode: "Markdown" }
        );
      }
    });

  } catch (error) {
    console.error("WhatsApp command error:", error);
    await bot.sendMessage(
      chatId,
      `⚠️ *Temporary Service Notice*\n\n` +
      `Our WhatsApp bot is available at:\n` +
      `📱 *+263 78 611 5435*\n\n` +
      `Send \`.menu\` to begin!\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}

case "chat": {
  try {
    const devContact = "263783525824"; // Developer's WhatsApp number
    
    await bot.sendMessage(
      chatId,
      `💬 *Direct Developer Chat* 💬\n\n` +
      `Choose your contact method:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "📱 WhatsApp Chat Now",
              callback_data: "chat_whatsapp"
            }]
          ]
        }
      }
    );

    // Callback handler
    bot.on('callback_query', async (callbackQuery) => {
      if (callbackQuery.data === "chat_whatsapp") {
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.sendMessage(
          callbackQuery.message.chat.id,
          `📲 *WhatsApp Chat*\n\n` +
          `Click below to chat directly:\n` +
          `👉 [Start Chat](https://wa.me/${devContact})\n\n` +
          `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
          {
            parse_mode: "Markdown",
            disable_web_page_preview: true
          }
        );
      }
    });

  } catch (error) {
    console.error("Chat command error:", error);
    await bot.sendMessage(
      chatId,
      `❌ Couldn't load chat options\n` +
      `Contact @iconictechofficial directly\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
  case "feedback": {
  try {
    // Store user data temporarily
    const userFeedback = {};
    userFeedback[chatId] = { awaitingFeedback: true };

    await bot.sendMessage(
      chatId,
      `📝 *Feedback Center*\n\n` +
      `Please type your feedback/suggestions below.\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "🚫 Cancel Feedback",
              callback_data: "feedback_cancel"
            }]
          ]
        }
      }
    );

    // Feedback collection handler
    const feedbackHandler = async (msg) => {
      if (msg.chat.id === chatId && userFeedback[chatId]?.awaitingFeedback) {
        const feedbackText = msg.text;
        
        // Remove listener to prevent multiple triggers
        bot.removeListener('message', feedbackHandler);
        delete userFeedback[chatId];

        await bot.sendMessage(
          chatId,
          `✅ *Feedback Received*\n\n` +
          `"${feedbackText}"\n\n` +
          `Thank you for your valuable input!`,
          { parse_mode: "Markdown" }
        );

        // Send WhatsApp option
        await bot.sendMessage(
          chatId,
          `📲 *Want faster response?*\n` +
          `[Message directly on WhatsApp](https://wa.me/263783525824?text=Feedback:%20${encodeURIComponent(feedbackText)})`,
          {
            parse_mode: "Markdown",
            disable_web_page_preview: true,
            reply_markup: {
              inline_keyboard: [
                [{
                  text: "📤 Send to Developer",
                  url: `https://wa.me/263783525824?text=Feedback:%20${encodeURIComponent(feedbackText)}`
                }]
              ]
            }
          }
        );
      }
    };

    bot.on('message', feedbackHandler);

    // Cancel callback handler
    bot.on('callback_query', async (callbackQuery) => {
      if (callbackQuery.data === "feedback_cancel") {
        delete userFeedback[chatId];
        bot.removeListener('message', feedbackHandler);
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.sendMessage(
          chatId,
          `❌ Feedback submission cancelled\n\n` +
          `You can try again anytime with /feedback`,
          { parse_mode: "Markdown" }
        );
      }
    });

  } catch (error) {
    console.error("Feedback command error:", error);
    await bot.sendMessage(
      chatId,
      `⚠️ Feedback system error\n` +
      `Please try again later\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
  case "about": {
  try {
    const thumbnailUrl = "https://files.catbox.moe/gyjcbb.png";
    
    await bot.sendPhoto(
      chatId,
      thumbnailUrl,
      {
        caption: `👨‍💻 *ABOUT THE DEVELOPER*\n` +
                 `╭─────────────────────\n` +
                 `│  *NAME*: Bright Chibondo\n` +
                 `│  *EDUCATION*: Nketa High School\n` +
                 `│  *AGE*: 19\n` +
                 `│  *LOCATION*: Bulawayo, Zimbabwe\n` +
                 `│  *SPECIALTY*: AI Bot Development\n` +
                 `╰─────────────────────\n\n` +
                 `⚡ *Currently coding next-gen chatbots*`,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "📱 WhatsApp Bot",
              callback_data: "about_whatsapp"
            }],
            [{
              text: "📢 Telegram Channel",
              url: "https://t.me/iconictechofficial"
            }],
            [{
              text: "👨‍💻 View Projects",
              callback_data: "about_projects"
            }]
          ]
        }
      }
    );

    // Callback handlers
    bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      
      switch(callbackQuery.data) {
        case "about_whatsapp":
          await bot.answerCallbackQuery(callbackQuery.id);
          await bot.sendMessage(
            chatId,
            `🤖 *WhatsApp Bot Info*\n\n` +
            `Experience Queen Ruva AI on WhatsApp:\n` +
            `📞 +263 78 611 5435\n` +
            `Send \`.menu\` to start\n\n` +
            `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
            {
              parse_mode: "Markdown",
              disable_web_page_preview: true
            }
          );
          break;

        case "about_projects":
          await bot.answerCallbackQuery(callbackQuery.id);
          await bot.sendMessage(
            chatId,
            `🚀 *Current Projects*\n\n` +
            `• Queen Ruva AI (Telegram/WhatsApp)\n` +
            `• Iconic Media Lyrics Finder\n` +
            `• Anime Download Platform\n\n` +
            `🌐 [View All Projects](https://kineboii.github.io)\n\n` +
            `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
            {
              parse_mode: "Markdown",
              disable_web_page_preview: true
            }
          );
          break;
      }
    });

  } catch (error) {
    console.error("About command error:", error);
    await bot.sendMessage(
      chatId,
      `❌ Couldn't load profile info\n` +
      `Try again later or contact @iconictechofficial\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
  case "hosting": {
  try {
    const thumbnailUrl = "https://files.catbox.moe/gyjcbb.png";
    
    await bot.sendPhoto(
      chatId,
      thumbnailUrl,
      {
        caption: `☁️ *Premium Bot Hosting* ☁️\n\n` +
                 `Deploy your bots with our reliable hosting solution\n\n` +
                 `⚡ * ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ*`,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "🌐 Visit Hosting Dashboard",
              url: "https://bot-hosting-dev.netlify.app/"
            }],
            [{
              text: "✨ Sign Up Now",
              url: "https://bot-hosting.net/?aff=1336281489364484136"
            }],
            [{
              text: "📚 Hosting Guide",
              callback_data: "hosting_guide"
            }]
          ]
        }
      }
    );

    // Callback handler for hosting guide
    bot.on('callback_query', async (callbackQuery) => {
      if (callbackQuery.data === "hosting_guide") {
        await bot.answerCallbackQuery(callbackQuery.id);
        await bot.sendMessage(
          callbackQuery.message.chat.id,
          `📖 *Hosting Setup Guide*\n\n` +
          `1. Create account via Sign Up link\n` +
          `2. Choose your hosting plan\n` +
          `3. Upload your bot files\n` +
          `4. Configure environment variables\n` +
          `5. Deploy and monitor\n\n` +
          `💡 *Pro Tip:* Start with our free tier to test\n\n` +
          `Need help? Contact @iconictechofficial\n\n` +
          `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
          {
            parse_mode: "Markdown",
            disable_web_page_preview: true
          }
        );
      }
    });

  } catch (error) {
    console.error("Hosting command error:", error);
    await bot.sendMessage(
      chatId,
      `❌ Couldn't load hosting information\n` +
      `Please visit directly:\n` +
      `🌐 [Hosting Link](https://bot-hosting-dev.netlify.app/)\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      {
        parse_mode: "Markdown",
        disable_web_page_preview: true
      }
    );
  }
  break;
}
case "restart": {
    // Show typing indicator for 3 seconds
    await bot.sendChatAction(chatId, 'typing');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Create interactive keyboard
    const restartKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "⚡ INSTANT RESTART", callback_data: "instant_restart" },
                    { text: "🛡️ SAFE RESTART", callback_data: "safe_restart" }
                ],
                [
                    { text: "❌ CANCEL", callback_data: "cancel_restart" }
                ]
            ]
        }
    };

    // Send restart panel
    const sentMessage = await bot.sendMessage(
        chatId,
        `♻️ *Queen Ruva AI Restart Panel* ♻️\n` +
        `_Version: BETA 1.0.0 | Dev: Iconic Tech_\n\n` +
        `⚠️ *Warning:* This will temporarily disconnect the bot\n` +
        `📊 *Current Memory:* ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB\n\n` +
        `🔻 *Select an option:*`,
        {
            parse_mode: "Markdown",
            ...restartKeyboard
        }
    );

    // Handle button presses
    bot.once("callback_query", async (callbackQuery) => {
        const chatId = callbackQuery.message.chat.id;
        const messageId = callbackQuery.message.message_id;
        const data = callbackQuery.data;

        try {
            if (data === "instant_restart") {
                // Countdown from 3
                for (let i = 3; i > 0; i--) {
                    await bot.editMessageText(
                        `⚡ *INSTANT RESTART INITIATED* ⚡\n` +
                        `⌛ Restarting in ${i} seconds...\n\n` +
                        `_This action cannot be canceled_`,
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: "Markdown"
                        }
                    );
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                await bot.editMessageText(
                    `🌀 *Queen Ruva AI is restarting...*\n` +
                    `⏳ Please wait 10-15 seconds`,
                    {
                        chat_id: chatId,
                        message_id: messageId, 
                        parse_mode: "Markdown"
                    }
                );
                process.exit(0);

            } else if (data === "safe_restart") {
                const steps = [
                    "🧹 Cleaning temporary files...",
                    "📦 Saving active sessions...", 
                    "🔒 Securing data...",
                    "✅ *All systems ready for restart*"
                ];
                
                for (const step of steps) {
                    await bot.editMessageText(
                        `🛡️ *SAFE RESTART SEQUENCE* 🛡️\n` +
                        `${step}\n\n` +
                        `_Please wait..._`,
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: "Markdown"
                        }
                    );
                    await new Promise(resolve => setTimeout(resolve, 1500));
                }
                
                await bot.editMessageText(
                    `🔄 *SAFE RESTART COMPLETE*\n` +
                    `♻️ Bot will now restart automatically\n\n` +
                    `_Reconnecting in 5 seconds..._`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: "Markdown"
                    }
                );
                setTimeout(() => process.exit(0), 5000);

            } else if (data === "cancel_restart") {
                await bot.editMessageText(
                    `🟢 *RESTART CANCELLED*\n\n` +
                    `🤖 Queen Ruva AI remains operational\n` +
                    `⏱️ Uptime: ${formatUptime(process.uptime())}`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: "Markdown"
                    }
                );
            }
            
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: `Action: ${data.replace("_", " ").toUpperCase()}`
            });
            
        } catch (error) {
            console.error("Restart error:", error);
        }
    });
    
    break;
}

// Uptime formatter
function formatUptime(seconds) {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${days}d ${hours}h ${mins}m ${secs}s`;
}
    case "menu": {
  const userName = msg.from.username || `User-${msg.from.id}`; // Retrieves the user's username or defaults to their user ID
  const currentDate = new Date().toLocaleString(); // Get the current date and time

  const menuText = `
╭━━━╔═══◆◇◆◇◆◇◆═══╗  
     ꧁𝑄𝑈𝐸𝐸𝑁 𝑅𝑈𝑉𝐴 𝐴𝐼 𝐵𝐸𝑇𝐴꧂
╚═══◆◇◆◇◆◇◆═══╝  
⫸ ⚡ ᴏᴡɴᴇʀ : ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ 
⫸ 🔰 ʙᴀɪʟᴇʏs : Multi Device  
⫸ 💻 ᴛʏᴘᴇ : Node.js  
⫸ 🌍 ᴘʟᴀᴛғᴏʀᴍ : Termux  
⫸ 🤖 ᴘʀᴇғɪx : *[/]*  
⫸ 🚀 ᴠᴇʀsɪᴏɴ : 1.0.0 Beta  
⫸ ⏳ ᴀʟᴡᴀʏs ᴏɴ : True  
⫸ 🏅 ᴜsᴇʀ : ${userName}  
⫸ 📅 ᴅᴀᴛᴇ : ${currentDate}  
═══════════════════≫⃫  
╰━━━━━━━━⤲━━━━━━━┈⊷

┏━━━✦ OWNER ✦━━━┓
┃ ⌬ owner  
┃ ⌬ contact  
┗━━━━━━━━━━━━━━┛
┏━━━✦ USER MENU ✦━━━┓
┃ ⌬ reverse  
┃ ⌬ tempemail  
┃ ⌬ date  
┃ ⌬ infor  
┃ ⌬ information  
┃ ⌬ settings  
┃ ⌬ help  
┃ ⌬ invite  
┃ ⌬ broadcast  
┃ ⌬ groupinfo  
┃ ⌬ Whatsapp  
┃ ⌬ feedback  
┃ ⌬ social  
┃ ⌬ ssweb  
┃ ⌬ genpassword  
┃ ⌬ url  
┃ ⌬ hosting  
┃ ⌬ about  
┗━━━━━━━━━⤲━━━━━━━━━┛
┏━━━✦ ANIMAL MENU ✦━━━┓
┃ ⌬ dog  
┃ ⌬ cat
┃ ⌬ fox
┃ ⌬ duck
┃ ⌬ bird
┃ ⌬ Raccoon
┃ ⌬ Kangaroo
┃ ⌬ Whale  
┃ ⌬ Dolphin
┃ ⌬ Giraffe
┃ ⌬ Lion
┃ ⌬ Panda
┃ ⌬ Redpanda
┃ ⌬ Elephant
┗━━━━━━━━━━━━━━━━━━━┛
┏━━━✦ HISTORY MENU ✦━━┓
┃ ⌬ history
┗━━━━━━━━━━━━━━━━━━━┛
┏━━━✦ RELIGION MENU ✦━━┓
┃ ⌬ bible 
┃ ⌬ quran
┃ ⌬ dhammapada
┗━━━━━━━━━━━━━━━━━━━┛
┏━━━✦ MEME MENU ✦━━━┓
┃ ⌬ meme 
┃ ⌬ drake 
┃ ⌬ oogway 
┃ ⌬ clown
┃ ⌬ sadcat
┗━━━━━━━━━━━━━━━━━━┛
┏━━━✦ GITHUB MENU ✦━━━┓
┃ ⌬ file  
┃ ⌬ repo  
┃ ⌬ gitclone  
┃ ⌬ searchrepo  
┃ ⌬ githubuser  
┗━━━━━━━━━━━━━━━━━━━┛
┏━━━✦ FROM DEV ✦━━━┓
┃ ⌬ message  
┃ ⌬ chat  
┗━━━━━━━━━━━━━━━┛
┏━━━✦ SYSTEM ✦━━━┓
┃ ⌬ runtime  
┃ ⌬ ping  
┃ ⌬ mooddetector  
┃ ⌬ mood  
┃ ⌬ date  
┃ ⌬ time  
┃ ⌬ autotyping  
┗━━━━━━━━━━━━━━┛
┏━━━✦ GAMES ✦━━━┓
┃ ⌬ Riddle
┃ ⌬ Roast  
┃ ⌬ Dadjoke
┃ ⌬ Ttt 
┃ ⌬ Dice
┃ ⌬ Flip
┃ ⌬ Rps 
┃ ⌬ hangman
┃ ⌬ 8ball  
┃ ⌬ tod
┗━━━━━━━━━━━━━━┛
┏━━━✦ GROUP MENU ✦━━━┓
┃ ⌬ setdesc  
┃ ⌬ promote  
┃ ⌬ demote  
┃ ⌬ pin  
┃ ⌬ unpin  
┃ ⌬ setwelcome  
┃ ⌬ setpic  
┃ ⌬ setrules  
┃ ⌬ rules  
┃ ⌬ poll  
┃ ⌬ groupmute  
┃ ⌬ unmutegroup  
┃ ⌬ clearchat  
┃ ⌬ kick  
┃ ⌬ ban  
┃ ⌬ groupinfo  
┃ ⌬ grouprule  
┃ ⌬ lyrics  
┃ ⌬ sticker  
┗━━━━━━━━━━━━━━━━━━┛
┏━━━✦ CHATGPT MENU ✦━━━┓
┃ ⌬ deepseek  
┃ ⌬ openai  
┃ ⌬ llama  
┃ ⌬ ai  
┗━━━━━━━━━━━━━━━━━━━━┛
┏━━━✦ AI IMG MENU ✦━━━┓
┃ ⌬ img  
┃ ⌬ anime  
┃ ⌬ pixabay  
┗━━━━━━━━━━━━━━━━━━━┛
╰━━━〔꧁꧂〕━━━┈⊷
꧁ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ꧂
  `;
  
  // Send typing action for 3 seconds
  bot.sendChatAction(chatId, 'typing');
  
  setTimeout(() => {
    bot.sendMessage(chatId, menuText, { parse_mode: "Markdown" });
  }, 3000);
}
case 'autotyping': {
    try {
        // Only trigger if command is exactly /autotyping
        if (!msg.text.match(/^\/autotyping(\s*)$/i)) break;

        const message = "Hello! This is an intelligent auto-typing effect from ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ 🤖💡.\n" +
                       "Developed with advanced algorithms 🌐. Enjoy the smart experience!";
        
        // Show typing indicator
        await bot.sendChatAction(chatId, 'typing');

        // Split into words for natural typing effect
        const words = message.split(" ");
        const messageParts = [];
        let currentPart = "";

        // Group words into chunks for more natural typing
        words.forEach(word => {
            if ((currentPart + word).length < 30) {
                currentPart += word + " ";
            } else {
                messageParts.push(currentPart.trim());
                currentPart = word + " ";
            }
        });
        if (currentPart) messageParts.push(currentPart.trim());

        // Send messages with realistic delays
        for (let i = 0; i < messageParts.length; i++) {
            const delay = 500 + Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, delay));
            
            const sentMsg = await bot.sendMessage(
                chatId, 
                messageParts[i], 
                { disable_notification: true }
            );

            // Simulate occasional typos (10% chance)
            if (Math.random() < 0.1) {
                await new Promise(resolve => setTimeout(resolve, 300));
                await bot.editMessageText(
                    messageParts[i] + "..", 
                    { chat_id: chatId, message_id: sentMsg.message_id }
                );
                await new Promise(resolve => setTimeout(resolve, 200));
                await bot.editMessageText(
                    messageParts[i], 
                    { chat_id: chatId, message_id: sentMsg.message_id }
                );
            }
        }

        // Final signature
        await new Promise(resolve => setTimeout(resolve, 800));
        await bot.sendMessage(
            chatId, 
            "🚀 Powered by ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ", 
            { disable_notification: true }
        );

    } catch (error) {
        console.error("Autotyping error:", error);
        await bot.sendMessage(
            chatId,
            "❌ Failed to demonstrate typing effect\n\n" +
            "⚡ Powered by ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ",
            { parse_mode: "Markdown" }
        );
    }
    break;
}
case 'fact': {
    try {
        // Show typing indicator
        await bot.sendChatAction(chatId, 'typing');

        // Fetch fact from API
        const response = await fetch('https://api.popcat.xyz/fact');
        if (!response.ok) throw new Error('Fact service unavailable');
        const { fact } = await response.json();

        // Prepare message with interactive buttons
        const factImageUrl = 'https://files.catbox.moe/fmndcl.jpg';
        const sentMessage = await bot.sendPhoto(
            chatId,
            factImageUrl,
            {
                caption: `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 Presents*\n` +
                         `✨ *FACT OF THE DAY* ✨\n\n` +
                         `▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                         `📌 "${fact}"\n` +
                         `▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                         `⚡ Created by Iconic Tech`,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: "🔄 New Fact",
                            callback_data: "new_fact"
                        }],
                        [{
                            text: "🌟 More Features",
                            callback_data: "ruva_features"
                        }]
                    ]
                }
            }
        );

        // Callback handlers
        bot.on('callback_query', async (callbackQuery) => {
            if (callbackQuery.message.message_id === sentMessage.message_id) {
                switch(callbackQuery.data) {
                    case "new_fact":
                        await bot.answerCallbackQuery(callbackQuery.id);
                        await bot.sendChatAction(chatId, 'typing');
                        
                        // Fetch new fact
                        const newResponse = await fetch('https://api.popcat.xyz/fact');
                        const { fact: newFact } = await newResponse.json();
                        
                        // Edit original message
                        await bot.editMessageCaption(
                            `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 Presents*\n` +
                            `✨ *FACT OF THE DAY* ✨\n\n` +
                            `▬▬▬▬▬▬▬▬▬▬▬▬\n` +
                            `📌 "${newFact}"\n` +
                            `▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
                            `⚡ Created by Iconic Tech`,
                            {
                                chat_id: chatId,
                                message_id: sentMessage.message_id,
                                parse_mode: "Markdown",
                                reply_markup: {
                                    inline_keyboard: [
                                        [{
                                            text: "🔄 New Fact",
                                            callback_data: "new_fact"
                                        }],
                                        [{
                                            text: "🌟 More Features",
                                            callback_data: "ruva_features"
                                        }]
                                    ]
                                }
                            }
                        );
                        break;

                    case "ruva_features":
                        await bot.answerCallbackQuery(callbackQuery.id);
                        await bot.sendMessage(
                            chatId,
                            `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 Features*\n\n` +
                            `• Smart Fact Generator\n` +
                            `• Mood Detection\n` +
                            `• Multi-platform Support\n` +
                            `• Advanced AI Conversations\n\n` +
                            `Try these commands:\n` +
                            `/menu - See all features\n` +
                            `/chat - Talk to the AI\n\n` +
                            `⚡ Created by Iconic Tech`,
                            {
                                parse_mode: "Markdown",
                                disable_web_page_preview: true
                            }
                        );
                        break;
                }
            }
        });

    } catch (error) {
        console.error('Fact command error:', error);
        await bot.sendMessage(
            chatId,
            `❌ *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 Error*\n` +
            `Fact service is currently unavailable\n\n` +
            `Try these instead:\n` +
            `/quote - Get an inspiring quote\n` +
            `/joke - Hear a funny joke\n\n` +
            `⚡ Created by Iconic Tech`,
            { parse_mode: "Markdown" }
        );
    }
    break;
}
case "skill": {
  try {
    await bot.sendMessage(
      chatId,
      `⚡ *Iconic Tech Expertise & Services* ⚡\n\n` +
      `Discover our technical capabilities and bot solutions:`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{
              text: "🤖 AI Development Skills",
              callback_data: "skill_ai"
            }],
            [{
              text: "👑 Ruva AI Beta (Telegram)",
              callback_data: "skill_ruva"
            }],
            [{
              text: "📱 WhatsApp Bot Solutions",
              callback_data: "skill_whatsapp"
            }],
            [{
              text: "🌐 View All Websites",
              callback_data: "skill_websites"
            }]
          ]
        }
      }
    );

    // Handle button responses
    bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data;

      let response;
      switch(data) {
        case "skill_ai":
          response = `🧠 *AI Development Expertise*\n\n` +
                     `We specialize in:\n` +
                     `• Natural Language Processing\n` +
                     `• Machine Learning Models\n` +
                     `• Conversational AI Design\n` +
                     `• Multi-platform Integration\n\n` +
                     `💡 Powering next-gen chatbots like Ruva AI`;
          break;
        
        case "skill_ruva":
          response = `👑 *Ruva AI Beta Features*\n\n` +
                     `• Advanced mood detection\n` +
                     `• Multi-language support\n` +
                     `• Custom command system\n` +
                     `• Interactive web dashboard\n\n` +
                     `🌐 Website: https://kineboii.github.io/Queen-ruva-official-web/`;
          break;
        
        case "skill_whatsapp":
          response = `📱 *WhatsApp Bot Solutions*\n\n` +
                     `• Business API integration\n` +
                     `• Automated customer service\n` +
                     `• Payment processing\n` +
                     `• Bulk messaging systems\n\n` +
                     `📞 Contact: +263 78 352 5824`;
          break;

        case "skill_websites":
          response = `🌐 *Our Digital Platforms*\n\n` +
                     `• Anime Downloads: anime-get.netlify.app\n` +
                     `• Ruva AI Official: https://kineboii.github.io/Queen-ruva-official-web/\n` +
                     `• Lyrics Finder: https://kineboii.github.io/iconicmedia-lyrics.app.com/\n` +
                     `• Tech Blog: https://kineboii.github.io/Iconic-tech-personalblog.com/`;
          break;
      }

      await bot.sendMessage(
        chatId,
        response + `\n\n⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
        { 
          parse_mode: "Markdown",
          disable_web_page_preview: true
        }
      );
      
      await bot.answerCallbackQuery(callbackQuery.id);
    });

  } catch (error) {
    console.error("Skill command error:", error);
    await bot.sendMessage(
      chatId,
      `❌ Couldn't load skill information\n` +
      `Please visit @iconictechofficial for details\n\n` +
      `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
      { parse_mode: "Markdown" }
    );
  }
  break;
}
//start of runtime 

//end of runtime 
case "date": {
    try {
        const currentDate = new Date();
        
        // Format date with emojis
        const formattedDate = currentDate.toLocaleString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        // Cool date templates
        const dateTemplates = [
            `⏳ *TIME MACHINE ACTIVATED* ⏳\n\n` +
            `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊* reveals:\n\n` +
            `🗓️ ${formattedDate}\n\n` +
            `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,

            `📅 *ROYAL DECREE*\n\n` +
            `By order of *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*:\n\n` +
            `⌚ ${formattedDate}\n\n` +
            `⚡ Created by Iconic Tech`,

            `✨ *COSMIC TIME CHECK* ✨\n\n` +
            `🌌 According to quantum calculations:\n\n` +
            `⏱️ ${formattedDate}\n\n` +
            `👑 𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊\n` +
            `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`
        ];

        // Select random template
        const randomTemplate = dateTemplates[Math.floor(Math.random() * dateTemplates.length)];
        const thumbnailUrl = "https://files.catbox.moe/w6je6q.jpg";

        // Send with interactive buttons
        await bot.sendPhoto(
            chatId,
            thumbnailUrl,
            {
                caption: randomTemplate,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: "🔄 Refresh Time",
                            callback_data: "refresh_date"
                        }],
                        [{
                            text: "⏳ Time Facts",
                            callback_data: "time_facts"
                        }]
                    ]
                }
            }
        );

        // Callback handlers
        bot.on('callback_query', async (callbackQuery) => {
            if (callbackQuery.data === "refresh_date") {
                const newDate = new Date().toLocaleString("en-US", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });

                await bot.editMessageCaption(
                    randomTemplate.replace(formattedDate, newDate),
                    {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id,
                        parse_mode: "Markdown"
                    }
                );
                await bot.answerCallbackQuery(callbackQuery.id, { text: "Time refreshed!" });
            }
            else if (callbackQuery.data === "time_facts") {
                await bot.answerCallbackQuery(callbackQuery.id);
                await bot.sendMessage(
                    chatId,
                    `⏳ *Cool Time Facts*\n\n` +
                    `• A day isn't exactly 24 hours\n` +
                    `• Time moves faster in space\n` +
                    `• The shortest war lasted 38 minutes\n\n` +
                    `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
                    `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
                    { parse_mode: "Markdown" }
                );
            }
        });

    } catch (error) {
        console.error("Date command error:", error);
        await bot.sendMessage(
            chatId,
            `❌ *Temporal Anomaly Detected*\n\n` +
            `Queen Ruva's clock malfunctioned!\n` +
            `Try again later...\n\n` +
            `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
            { parse_mode: "Markdown" }
        );
    }
    break;
}
case 'quotes':
case 'quote': {
    try {
        // Show typing indicator
        await bot.sendChatAction(chatId, 'typing');

        // Fetch quote from API
        const response = await fetch('https://apis.davidcyriltech.my.id/random/quotes');
        if (!response.ok) throw new Error('Quote service unavailable');
        const { response: { quote, author } } = await response.json();

        // Random message templates
        const randomTemplates = [
            `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 Presents*\n` +
            `💫 *Inspirational Quote*\n\n` +
            `▬▬▬▬▬▬▬▬▬▬▬▬\n` +
            `✍️ *${author}*\n` +
            `"${quote}"\n` +
            `▬▬▬▬▬▬▬▬▬▬▬▬\n\n` +
            `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,

            `✨ *Quote of the Day* ✨\n\n` +
            `👑 *From the wisdom banks of 𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n\n` +
            `📜 *${author}* once said:\n` +
            `"${quote}"\n\n` +
            `⚡ Created by Iconic Tech`,

            `🌟 *Daily Motivation*\n\n` +
            `"${quote}"\n\n` +
            `— *${author}*\n\n` +
            `👑 Shared by 𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊\n` +
            `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`
        ];

        // Select random template
        const randomIndex = Math.floor(Math.random() * randomTemplates.length);
        const caption = randomTemplates[randomIndex];

        // Send quote with thumbnail
        const thumbnailUrl = 'https://files.catbox.moe/c6eq8u.jpg';
        await bot.sendPhoto(
            chatId,
            thumbnailUrl,
            {
                caption: caption,
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: "🔄 New Quote",
                            callback_data: "new_quote"
                        }],
                        [{
                            text: "📚 More Wisdom",
                            callback_data: "more_quotes"
                        }]
                    ]
                }
            }
        );

        // Callback handlers
        bot.on('callback_query', async (callbackQuery) => {
            const currentMessageId = callbackQuery.message.message_id;
            
            switch(callbackQuery.data) {
                case "new_quote":
                    await bot.answerCallbackQuery(callbackQuery.id);
                    await bot.sendChatAction(chatId, 'typing');
                    
                    // Fetch new quote
                    const newResponse = await fetch('https://apis.davidcyriltech.my.id/random/quotes');
                    const { response: { quote: newQuote, author: newAuthor } } = await newResponse.json();
                    
                    // Update random template selection
                    const newRandomIndex = Math.floor(Math.random() * randomTemplates.length);
                    const newCaption = randomTemplates[newRandomIndex]
                        .replace('${author}', newAuthor)
                        .replace('${quote}', newQuote);
                    
                    // Edit original message
                    await bot.editMessageMedia(
                        {
                            type: "photo",
                            media: thumbnailUrl,
                            caption: newCaption,
                            parse_mode: "Markdown"
                        },
                        {
                            chat_id: chatId,
                            message_id: currentMessageId,
                            reply_markup: {
                                inline_keyboard: [
                                    [{
                                        text: "🔄 New Quote",
                                        callback_data: "new_quote"
                                    }],
                                    [{
                                        text: "📚 More Wisdom",
                                        callback_data: "more_quotes"
                                    }]
                                ]
                            }
                        }
                    );
                    break;

                case "more_quotes":
                    await bot.answerCallbackQuery(callbackQuery.id);
                    await bot.sendMessage(
                        chatId,
                        `📖 *Wisdom Collection*\n\n` +
                        `Try these commands:\n` +
                        `/motivate - Uplifting messages\n` +
                        `/proverb - Cultural wisdom\n` +
                        `/poem - Beautiful verses\n\n` +
                        `👑 *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊*\n` +
                        `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
                        { parse_mode: "Markdown" }
                    );
                    break;
            }
        });

    } catch (error) {
        console.error('Quote command error:', error);
        await bot.sendMessage(
            chatId,
            `❌ *𝚀𝚞𝚎𝚎𝚗 𝚁𝚞𝚟𝚊 𝙰𝚒 𝙱𝚊𝚝𝚊 Error*\n` +
            `Couldn't fetch wisdom at this time\n\n` +
            `Try these instead:\n` +
            `/fact - Interesting facts\n` +
            `/joke - Lighten your mood\n\n` +
            `⚡  ᴘᴏᴡᴇʀᴇᴅ ʙʏ ɪᴄᴏɴɪᴄ ᴛᴇᴄʜ`,
            { parse_mode: "Markdown" }
        );
    }
    break;
}

    default:
  // Do nothing, bot will not reply to unrecognized commands
  break; // Ensure the switch case exits properly
}
});
// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'online',
    bot: 'Queen Ruva AI',
    version: '1.0.0'
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`╭───────────────────────────────────────────────────`);
  console.log(`│> Bot running on port ${PORT}`);
  console.log(`╰───────────────────────────────────────────────────`);
});
