// FredieTech tz 🇹🇿 team
import express from 'express';
import { Boom } from '@hapi/boom';
import { 
    default as makeWASocket, 
    makeInMemoryStore, 
    useMultiFileAuthState, 
    makeCacheableSignalKeyStore, 
    fetchLatestBaileysVersion,
    delay as baileysDelay,
    downloadContentFromMessage,
    DisconnectReason,
    getContentType,
    jidDecode
} from '@whiskeysockets/baileys';
import logger from '@whiskeysockets/baileys/lib/Utils/logger';
import pino from 'pino';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { fileTypeFromBuffer } from 'file-type';
import { Sticker, StickerTypes } from 'wa-sticker-formatter';
import chalk from 'chalk';
import { inflate, deflate } from 'pako';
import { verifierEtatJid, recupererActionJid } from './lib/antilien.js';
import { atbverifierEtatJid, atbrecupererActionJid } from './lib/antibot.js';
import { sendMessage, getContextInfo } from './fredi/context.js';
import evt from './fredi/ezra.js';
import { isUserBanned, addUserToBanList, removeUserFromBanList } from './lib/banUser.js';
import { addGroupToBanList, isGroupBanned, removeGroupFromBanList } from './lib/banGroup.js';
import { isGroupOnlyAdmin, addGroupToOnlyAdminList, removeGroupFromOnlyAdminList } from './lib/onlyAdmin.js';
import { reagir } from './fredi/app.js';
import conf from './set.js';

// Express server
const app = express();
const PORT = process.env.PORT || 8000;
app.get("/", (req, res) => {
    res.send("Tech-Expert-Md IS ALIVE 🫧");
});
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Constants
const prefixe = conf.PREFIXE;
const more = String.fromCharCode(8206);
const readmore = more.repeat(4001);
const BaseUrl = process.env.GITHUB_GIT;
const Ezraapikey = process.env.BOT_OWNER;

// Fonction pour decompresser session ya zlib base64
function decompressZlibBase64Session(compressedSession) {
    try {
        if (!compressedSession || compressedSession.trim() === '') {
            console.log("Session is empty");
            return null;
        }

        // Remove FEE-XMD% prefix if exists
        const cleanSession = compressedSession.replace(/FEE-XMD%/g, "");
        console.log("Cleaned session length:", cleanSession.length);

        // Decode base64
        const base64Data = atob(cleanSession);

        // Convert to Uint8Array for zlib decompression
        const uint8Array = new Uint8Array(base64Data.length);
        for (let i = 0; i < base64Data.length; i++) {
            uint8Array[i] = base64Data.charCodeAt(i);
        }

        // Decompress zlib using pako
        const decompressed = inflate(uint8Array);

        // Convert to string
        const sessionString = new TextDecoder().decode(decompressed);
        console.log("Session decompressed successfully, length:", sessionString.length);

        return sessionString;
    } catch (error) {
        console.error("Error decompressing session:", error);
        console.error("Error stack:", error.stack);
        return null;
    }
}

// Fonction pour compress session to zlib base64
function compressToZlibBase64(sessionData) {
    try {
        // Convert string to Uint8Array
        const encoder = new TextEncoder();
        const uint8Array = encoder.encode(sessionData);

        // Compress with zlib using pako
        const compressed = deflate(uint8Array);

        // Convert to base64
        let binaryString = '';
        for (let i = 0; i < compressed.length; i++) {
            binaryString += String.fromCharCode(compressed[i]);
        }

        const base64Result = btoa(binaryString);
        console.log("Session compressed to base64, length:", base64Result.length);

        return "FEE-XMD%" + base64Result;
    } catch (error) {
        console.error("Error compressing session:", error);
        return null;
    }
}

async function authentification() {
    try {
        const session = conf.session || '';
        console.log("Session from config:", session ? "Provided" : "Empty");

        if (!fs.existsSync(path.join(__dirname, "/scan/creds.json"))) {
            console.log("Connexion en cours avec session base64 zlib...");

            if (session) {
                // Decompress session
                const decompressedSession = decompressZlibBase64Session(session);

                if (decompressedSession) {
                    await fs.writeFileSync(path.join(__dirname, "/scan/creds.json"), decompressedSession, "utf8");
                    console.log("Session decompressée et enregistrée avec succès");
                    return true;
                } else {
                    console.log("Session invalide ou erreur de décompression");
                    console.log("QR code sera affiché pour nouvelle connexion");
                    return false;
                }
            } else {
                console.log("Pas de session fournie, QR code sera affiché");
                return false;
            }
        } else if (fs.existsSync(path.join(__dirname, "/scan/creds.json")) && session && session !== "zokk") {
            // Mise à jour de la session
            const decompressedSession = decompressZlibBase64Session(session);

            if (decompressedSession) {
                await fs.writeFileSync(path.join(__dirname, "/scan/creds.json"), decompressedSession, "utf8");
                console.log("Session mise à jour avec succès");
                return true;
            }
        }

        return true;
    } catch (e) {
        console.log("Erreur d'authentification: " + e);
        console.error(e.stack);
        return false;
    }
}

// Store setup
const store = makeInMemoryStore({
    logger: pino().child({ level: "silent", stream: "store" }),
});

// 50 Raw Emojis only (mixed categories)
const reactionEmojis = [
    // Smileys & People
    "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🥲", "☺️",
    "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗",
    // Hands & Gestures
    "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞",
    // Objects
    "💎", "🔥", "💫", "⭐", "🌟", "✨", "🎉", "🎊", "🏆", "🎯",
    // Nature
    "🌹", "🌸", "🌺", "🌻", "🌼", "🌷", "💐", "🌱", "🌿", "🍃",
    // Misc
    "❤️", "💖", "💕", "💞", "💓", "💗", "💘", "💝", "💟", "☮️"
];

// Get random emoji
const getRandomEmoji = () => {
    return reactionEmojis[Math.floor(Math.random() * reactionEmojis.length)];
};

setTimeout(async () => {
    await authentification();

    async function main() {
        const { version, isLatest } = await fetchLatestBaileysVersion();

        // Utiliser useMultiFileAuthState pour charger les creds
        const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, "/scan"));

        // Configuration du socket
        const sockOptions = {
            version,
            logger: pino({ level: "silent" }),
            browser: ['Fee-Xmd', "safari", "1.0.0"],
            printQRInTerminal: true,
            fireInitQueries: false,
            shouldSyncHistoryMessage: true,
            downloadHistory: true,
            syncFullHistory: true,
            generateHighQualityLinkPreview: true,
            markOnlineOnConnect: false,
            keepAliveIntervalMs: 30000,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            getMessage: async (key) => {
                if (store) {
                    const msg = await store.loadMessage(key.remoteJid, key.id, undefined);
                    return msg.message || undefined;
                }
                return {
                    conversation: 'An Error Occurred, Repeat Command!'
                };
            }
        };

        // Créer le socket
        const zk = makeWASocket(sockOptions);

        // Bind store to socket events
        store.bind(zk.ev);

        // Sauvegarder les creds quand ils changent
        zk.ev.on('creds.update', saveCreds);

        // Fonction pour sauvegarder la session en format zlib base64
        async function saveSessionToZlibBase64() {
            try {
                if (fs.existsSync(path.join(__dirname, "/scan/creds.json"))) {
                    const sessionData = await fs.readFileSync(path.join(__dirname, "/scan/creds.json"), "utf8");
                    const compressedSession = compressToZlibBase64(sessionData);

                    if (compressedSession) {
                        console.log(chalk.green("\n" + "═".repeat(50)));
                        console.log(chalk.yellow.bold("SESSION COMPRESSÉE (Zlib Base64):"));
                        console.log(chalk.green("═".repeat(50)));
                        console.log(chalk.cyan(compressedSession));
                        console.log(chalk.green("═".repeat(50)));
                        console.log(chalk.yellow("Copiez cette session et collez-la dans votre fichier set.js"));
                        console.log(chalk.green("═".repeat(50) + "\n"));

                        // Optionnel: Sauvegarder dans un fichier
                        await fs.writeFileSync(
                            path.join(__dirname, "/session_compressed.txt"),
                            compressedSession,
                            "utf8"
                        );

                        console.log(chalk.green("Session sauvegardée dans: session_compressed.txt"));
                    }
                }
            } catch (error) {
                console.error("Erreur lors de la sauvegarde de la session:", error);
            }
        }



// Function to get the current date and time in Tanzania
function getCurrentDateTime() {
    const now = new Date();
    const options = {
        timeZone: 'Africa/Nairobi',
        weekday: 'long',    // e.g., Monday
        year: 'numeric',
        month: 'long',      // e.g., June
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    };
    return new Intl.DateTimeFormat('en-KE', options).format(now);
}

// 🌟 Dynamic Motivational, Meme & Skill Phrases
const bioLines = [
    "🛠️ Learning never ends — debug life!",
    "🔥 Bot powered by memes & dreams 😎",
    "🎯 Skills don't sleep... neither do bots 🤖",
    "💡 Every day is a code update day!",
    "📅 Stay productive — even in downtime!",
    "😂 If bots had feelings... mine would be busy.",
    "🚀 Running like a boss at 1000 scripts/sec.",
    "🌍 Global bot vibes from TZ 🇹🇿",
    "📚 Guide, Help, Fun, Repeat.",
    "🤹 Life is a mix of memes & miracles.",
    "👀 Watching you like console logs 👨‍💻",
    "📌 Daily desk goals: Build, Break, Fix, Repeat.",
    "🎭 This bot has more personalities than your ex.",
    "👑 Bot: Tech-Expert-Md | AI: Fredi AI",
    "✨ Today is yours. Make it *legendary*.",
    "📊 Performance: 100% Efficiency (maybe 💀)",
    "⚙️ Built with ❤️ by FredieTech",
    "🎮 Skills unlocked: AI | Code | Meme | Hustle"
];

// 🔁 Rotate bios with different moods every 60s
let bioIndex = 0;

setInterval(async () => {
    if (conf.AUTO_BIO === "yes") {
        const currentDateTime = getCurrentDateTime();

        const dynamicLine = bioLines[bioIndex];
        const bioText = `🤖 Tech-Expert-Md is Active\n📅 ${currentDateTime}\n${dynamicLine}`;

        await zk.updateProfileStatus(bioText); // Update the bio
        console.log(`✅ Updated Bio:\n${bioText}`);

        bioIndex = (bioIndex + 1) % bioLines.length; // Loop through bios
    }
}, 60000); // Update every 60 seconds


// Function to handle deleted messages
// Other functions (auto-react, anti-delete, etc.) as needed
zk.ev.on("call", async (callData) => {
  if (conf.ANTI_CALL === 'yes') {
    const callId = callData[0].id;
    const callerId = callData[0].from;

    await zk.rejectCall(callId, callerId);

    if (!global.callResponses) global.callResponses = {};
    if (!global.callResponses[callerId]) global.callResponses[callerId] = { count: 0 };

    const callerData = global.callResponses[callerId];
    callerData.count++;

    // Define messages per call level
    const callMessages = {
      1: [
        `📞 Hello 👋! I'm ${conf.BOT}. Please avoid calling, my owner ${conf.OWNER_NAME} prefers messages. Thank you!\n\nPowered by ${conf.DEV}`,
        `🚫 Please don't call. ${conf.BOT} is a bot, not a voice assistant.\n\nPowered by ${conf.DEV}`,
        `Hi! 🙏 Kindly don’t call. My creator ${conf.OWNER_NAME} has disabled calling. Just message me.\n\n~ ${conf.BOT}`
      ],
      2: [
        `⚠️ You've called again. Calls are not allowed. Please text.\n\nPowered by ${conf.DEV}`,
        `Reminder: No calls allowed 🚫. Kindly send your message instead.`,
        `You're trying again? 😅 This bot does not accept calls. Just type your message.`
      ],
      3: [
        `📵 Third time calling! Respect the rules and drop a message please.`,
        `Hey friend, this is the 3rd call. Please avoid that 🙏.`,
        `Still calling? 😔 Please understand, texting is preferred.`
      ],
    };

    const level = callerData.count >= 3 ? 3 : callerData.count;
    const messages = callMessages[level];

    // Chagua randomly ujumbe mmojawapo wa kiwango hicho
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];

    try {
      await zk.sendMessage(callerId, { text: randomMessage });
    } catch (e) {
      console.error("Error sending anti-call message:", e);
    }
  }
});

        // Default auto-reply message
let auto_reply_message = `Hello👋, I'm ${conf.BOT} on board. My owner ${conf.OWNER_NAME} currently unavailable👁️. Please leave a message, and we will get back to you as soon as possible🤝. Thanks To ${conf.DEV}`;

// Track contacts that have already received the auto-reply
let repliedContacts = new Set();

zk.ev.on("messages.upsert", async (m) => {
    const { messages } = m;
    const ms = messages[0];
    if (!ms.message) return;

    const messageText = ms.message.conversation || ms.message.extendedTextMessage?.text;
    const remoteJid = ms.key.remoteJid;

    // Check if the message exists and is a command to set a new auto-reply message with any prefix
    if (messageText && messageText.match(/^[^\w\s]/) && ms.key.fromMe) {
        const prefix = messageText[0]; // Detect the prefix
        const command = messageText.slice(1).split(" ")[0]; // Command after prefix
        const newMessage = messageText.slice(prefix.length + command.length).trim(); // New message content

        // Update the auto-reply message if the command is 'setautoreply'
        if (command === "setautoreply" && newMessage) {
            auto_reply_message = newMessage;
            await zk.sendMessage(remoteJid, {
                text: `Auto-reply message has been updated to:\n"${auto_reply_message}"`,
            });
            return;
        }
    }

    // Check if auto-reply is enabled, contact hasn't received a reply, and it's a private chat
    if (conf.AUTO_REPLY === "yes" && !repliedContacts.has(remoteJid) && !ms.key.fromMe && !remoteJid.includes("@g.us")) {
        await zk.sendMessage(remoteJid, {
            text: auto_reply_message,
        });

        // Add contact to replied set to prevent repeat replies
        repliedContacts.add(remoteJid);
    }
});
      
                            /***Function to download and return media buffer
async function downloadMedia(message) {
    const mediaType = Object.keys(message)[0].replace('Message', ''); // Determine the media type
    try {
        const stream = await zk.downloadContentFromMessage(message[mediaType], mediaType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        return buffer;
    } catch (error) {
        console.error('Error downloading media:', error);
        return null;
    }
} ***/

// Function to handle anti-delete
// ✅ Log active status
if (conf.LUCKY_ADM === "yes") {
  console.log("🛡️ Tech-Expert-Md AntiDelete is ACTIVE!");
}

zk.ev.on("messages.upsert", async (m) => {
  if (conf.LUCKY_ADM !== "yes") return;

  const { messages } = m;
  const ms = messages[0];
  if (!ms.message) return;

  const messageKey = ms.key;
  const remoteJid = messageKey.remoteJid;

  // Ignore status updates
  if (remoteJid === "status@broadcast") return;

  // Initialize chat history
  if (!store.chats[remoteJid]) {
    store.chats[remoteJid] = [];
  }

  // Save message
  store.chats[remoteJid].push(ms);
  if (store.chats[remoteJid].length > 25) store.chats[remoteJid].shift(); // limit memory

  // ✅ Handle deleted message event
  if (ms.message?.protocolMessage?.type === 0) {
    const deletedKey = ms.message.protocolMessage.key;
    const chatMessages = store.chats[remoteJid];
    const deletedMessage = chatMessages.find(msg => msg.key.id === deletedKey.id);

    if (!deletedMessage) return;

    try {
      const deleterJid = ms.key.participant || ms.key.remoteJid;
      const originalSenderJid = deletedMessage.key.participant || deletedMessage.key.remoteJid;
      const isGroup = remoteJid.endsWith('@g.us');

      // 🧾 Group Metadata
      let groupInfo = '';
      if (isGroup) {
        try {
          const groupMetadata = await zk.groupMetadata(remoteJid);
          groupInfo = `\n• Group: ${groupMetadata.subject}`;
        } catch (e) {
          console.error('Error fetching group metadata:', e);
          groupInfo = '\n• Group information unavailable.';
        }
      }

      // 🪧 Notification Text
      const notification = `🫧 *Tech-Expert-Md antiDelete* 🫧\n` +
        `• Deleted by: @${deleterJid.split("@")[0]}\n` +
        `• Original sender: @${originalSenderJid.split("@")[0]}\n` +
        `${groupInfo}\n` +
        `• Chat type: ${isGroup ? 'Group' : 'Private'}`;

      const baseOpts = {
        mentions: [deleterJid, originalSenderJid]
      };

      // ✅ Forward different message types
      if (deletedMessage.message.conversation) {
        await sendMessage(zk, remoteJid, ms, {
          text: `${notification}\n\n📝 *Deleted Text:*\n${deletedMessage.message.conversation}`,
          ...baseOpts
        });
      } else if (deletedMessage.message.extendedTextMessage) {
        await sendMessage(zk, remoteJid, ms, {
          text: `${notification}\n\n📝 *Deleted Text:*\n${deletedMessage.message.extendedTextMessage.text}`,
          ...baseOpts
        });
      } else if (deletedMessage.message.imageMessage) {
        const caption = deletedMessage.message.imageMessage.caption || '';
        const imagePath = await zk.downloadAndSaveMediaMessage(deletedMessage.message.imageMessage);
        await sendMessage(zk, remoteJid, ms, {
          image: { url: imagePath },
          caption: `${notification}\n\n🖼️ *Image Caption:*\n${caption}`,
          ...baseOpts
        });
      } else if (deletedMessage.message.videoMessage) {
        const caption = deletedMessage.message.videoMessage.caption || '';
        const videoPath = await zk.downloadAndSaveMediaMessage(deletedMessage.message.videoMessage);
        await sendMessage(zk, remoteJid, ms, {
          video: { url: videoPath },
          caption: `${notification}\n\n🎥 *Video Caption:*\n${caption}`,
          ...baseOpts
        });
      } else if (deletedMessage.message.audioMessage) {
        const audioPath = await zk.downloadAndSaveMediaMessage(deletedMessage.message.audioMessage);
        await sendMessage(zk, remoteJid, ms, {
          audio: { url: audioPath },
          mimetype: 'audio/ogg',
          ptt: true,
          caption: `${notification}\n\n🎤 *Voice Message Deleted*`,
          ...baseOpts
        });
      } else if (deletedMessage.message.stickerMessage) {
        const stickerPath = await zk.downloadAndSaveMediaMessage(deletedMessage.message.stickerMessage);
        await sendMessage(zk, remoteJid, ms, {
          sticker: { url: stickerPath },
          caption: notification,
          ...baseOpts
        });
      } else {
        await sendMessage(zk, remoteJid, ms, {
          text: `${notification}\n\n⚠️ *An unsupported message type was deleted.*`,
          ...baseOpts
        });
      }

    } catch (err) {
      console.error("🔥 AntiDelete Error:", err);
    }
  }
});


     // Utility function for delay
            // Auto-react to messages
            if (conf.AUTO_REACT === "yes" && !ms.key.fromMe) {
                const now = Date.now();
                if (now - lastReactionTime > 5000) {
                    const randomEmoji = getRandomEmoji();
                    try {
                        await zk.sendMessage(remoteJid, {
                            react: {
                                text: randomEmoji,
                                key: ms.key
                            }
                        });
                        lastReactionTime = now;
                        console.log(`Reacted with ${randomEmoji} to message from ${remoteJid}`);
                    } catch (error) {
                        console.error("Failed to react:", error);
                    }
                }
            }

            // Auto-react to status updates
            if (conf.AUTO_REACT_STATUS === "yes" && remoteJid === "status@broadcast") {
                const now = Date.now();
                if (now - lastReactionTime > 5000) {
                    const randomEmoji = getRandomEmoji();
                    try {
                        const ezra = zk.user?.id ? zk.user.id.split(":")[0] + "@s.whatsapp.net" : null;
                        if (ezra) {
                            await zk.sendMessage(remoteJid, {
                                react: {
                                    key: ms.key,
                                    text: randomEmoji,
                                },
                            }, {
                                statusJidList: [ms.key.participant, ezra],
                            });
                            lastReactionTime = now;
                            console.log(`Reacted with ${randomEmoji} to status update`);
                        }
                    } catch (error) {
                        console.error("Failed to react to status:", error);
                    }
                }
            }
   
// Function to create and send vCard for a new contact with incremented numbering
async function sendVCard(jid, baseName) {
    try {
        // Extract phone number from JID
        const phoneNumber = jid.split('@')[0];
        
        // Generate unique name with incremented number
        let counter = 1;
        let name = `${baseName} ${counter}`;

        // Check existing contacts to find the next available number
        while (Object.values(store.contacts).some(contact => contact.name === name)) {
            counter++;
            name = `${baseName} ${counter}`;
        }

        // Manually construct vCard content
        const vCardContent = `BEGIN:VCARD\nVERSION:3.0\nFN:${name}\nTEL;type=CELL;type=VOICE;waid=${phoneNumber}:+${phoneNumber}\nEND:VCARD\n`;
        
        // Define the path and file name for the vCard file
        const vCardPath = `./${name}.vcf`;
        
        // Write the vCard content to a .vcf file
        fs.writeFileSync(vCardPath, vCardContent);

        // Send the vCard to yourself (the bot owner) for easy importing
        await zk.sendMessage(conf.NUMERO_OWNER + "@s.whatsapp.net", {
            document: { url: vCardPath },
            mimetype: 'text/vcard',
            fileName: `${name}.vcf`,
            caption: `Contact saved as ${name}. Please import this vCard to add the number to your contacts.\n\n Tech-Expert-Md`
        });

        console.log(`vCard created and sent for: ${name} (${jid})`);

        // Delete the vCard file after sending
        fs.unlinkSync(vCardPath);

        return name;  // Return the assigned name to use in the notification
    } catch (error) {
        console.error(`Error creating or sending vCard for ${name}:`, error.message);
    }
}
// New Contact Handler
zk.ev.on("messages.upsert", async (m) => {
    // Check if AUTO_SAVE_CONTACTS is enabled
    if (conf.AUTO_SAVE_CONTACTS !== "yes") return;

    const { messages } = m;
    const ms = messages[0];

    if (!ms.message) return;

    const origineMessage = ms.key.remoteJid;
    const baseName = "Tech-Expert-Md";

    // Check if the message is from an individual and if contact is not saved
    if (origineMessage.endsWith("@s.whatsapp.net") && (!store.contacts[origineMessage] || !store.contacts[origineMessage].name)) {
        // Generate and save contact with incremented name
        const assignedName = await sendVCard(origineMessage, baseName);

        // Update contact in store to avoid duplicate saving
        store.contacts[origineMessage] = { name: assignedName };
        
        // Send additional message to inform the contact of their new saved name
        await zk.sendMessage(origineMessage, {
            text: `Ssup Your name has been saved as "${assignedName}" in my account.\n\nTech-Expert-Md`
        });

        console.log(`Contact ${assignedName} has been saved and notified.`);
    }

    // Further message handling for saved contacts can be added here...
});
        
        zk.ev.on("messages.upsert", async (m) => {
            const { messages } = m;
            const ms = messages[0];
            if (!ms.message)
                return;
            const decodeJid = (jid) => {
                if (!jid)
                    return jid;
                if (/:\d+@/gi.test(jid)) {
                    let decode = (0, baileys_1.jidDecode)(jid) || {};
                    return decode.user && decode.server && decode.user + '@' + decode.server || jid;
                }
                else
                    return jid;
            };
            var mtype = (0, baileys_1.getContentType)(ms.message);
            var texte = mtype == "conversation" ? ms.message.conversation : mtype == "imageMessage" ? ms.message.imageMessage?.caption : mtype == "videoMessage" ? ms.message.videoMessage?.caption : mtype == "extendedTextMessage" ? ms.message?.extendedTextMessage?.text : mtype == "buttonsResponseMessage" ?
                ms?.message?.buttonsResponseMessage?.selectedButtonId : mtype == "listResponseMessage" ?
                ms.message?.listResponseMessage?.singleSelectReply?.selectedRowId : mtype == "messageContextInfo" ?
                (ms?.message?.buttonsResponseMessage?.selectedButtonId || ms.message?.listResponseMessage?.singleSelectReply?.selectedRowId || ms.text) : "";
            var origineMessage = ms.key.remoteJid;
            var idBot = decodeJid(zk.user.id);
            var servBot = idBot.split('@')[0];
            /* const fredi='255620814108';
             const ezra='255764182801';
             const fredietech='255752593977'*/
            /*  var superUser=[servBot,fredi,ezra,fredietech].map((s)=>s.replace(/[^0-9]/g)+"@s.whatsapp.net").includes(auteurMessage);
              var dev =[fredi,ezra,fredietech].map((t)=>t.replace(/[^0-9]/g)+"@s.whatsapp.net").includes(auteurMessage);*/
            const verifGroupe = origineMessage?.endsWith("@g.us");
            var infosGroupe = verifGroupe ? await zk.groupMetadata(origineMessage) : "";
            var nomGroupe = verifGroupe ? infosGroupe.subject : "";
            var msgRepondu = ms.message.extendedTextMessage?.contextInfo?.quotedMessage;
            var auteurMsgRepondu = decodeJid(ms.message?.extendedTextMessage?.contextInfo?.participant);
            //ms.message.extendedTextMessage?.contextInfo?.mentionedJid
            // ms.message.extendedTextMessage?.contextInfo?.quotedMessage.
            var mr = ms.Message?.extendedTextMessage?.contextInfo?.mentionedJid;
            var utilisateur = mr ? mr : msgRepondu ? auteurMsgRepondu : "";
            var auteurMessage = verifGroupe ? (ms.key.participant ? ms.key.participant : ms.participant) : origineMessage;
            if (ms.key.fromMe) {
                auteurMessage = idBot;
            }
            
            var membreGroupe = verifGroupe ? ms.key.participant : '';
            const { getAllSudoNumbers } = require("./lib/sudo");
            const nomAuteurMessage = ms.pushName;
            const fredietech = '255752593977';
            const meshack = '255711389698';
            const ezra = "255764182801";
            const sudo = await getAllSudoNumbers();
            const superUserNumbers = [servBot, fredietech, meshack, ezra, conf.NUMERO_OWNER].map((s) => s.replace(/[^0-9]/g) + "@s.whatsapp.net");
            const allAllowedNumbers = superUserNumbers.concat(sudo);
            const superUser = allAllowedNumbers.includes(auteurMessage);
            
            var dev = [fredietech, fredi,ezra].map((t) => t.replace(/[^0-9]/g) + "@s.whatsapp.net").includes(auteurMessage);
            function repondre(mes) { zk.sendMessage(origineMessage, { text: mes }, { quoted: ms }); }
            console.log("Tech-Expert-Md");
            console.log("=========== NEW CONVERSATION ===========");
            if (verifGroupe) {
                console.log("MESSAGE FROM GROUP : " + nomGroupe);
            }
            console.log("MESSAGE SENT BY : " + "[" + nomAuteurMessage + " : " + auteurMessage.split("@s.whatsapp.net")[0] + " ]");
            console.log("MESSAGE TYPE : " + mtype);
            console.log("==================TEXT==================");
            console.log(texte);
            /**  */
            function groupeAdmin(membreGroupe) {
                let admin = [];
                for (m of membreGroupe) {
                    if (m.admin == null)
                        continue;
                    admin.push(m.id);
                }
                // else{admin= false;}
                return admin;
            }



            var etat = conf.ETAT;
// Presence update logic based on etat value
if (etat == 1) {
    await zk.sendPresenceUpdate("available", origineMessage);
} else if (etat == 2) {
    await zk.sendPresenceUpdate("composing", origineMessage);
} else if (etat == 3) {
    await zk.sendPresenceUpdate("recording", origineMessage);
} else {
    await zk.sendPresenceUpdate("unavailable", origineMessage);
}

const mbre = verifGroupe ? await infosGroupe.participants : '';
let admins = verifGroupe ? groupeAdmin(mbre) : '';
const verifAdmin = verifGroupe ? admins.includes(auteurMessage) : false;
var verifEzraAdmin = verifGroupe ? admins.includes(idBot) : false;

const arg = texte ? texte.trim().split(/ +/).slice(1) : null;
const verifCom = texte ? texte.startsWith(prefixe) : false;
const com = verifCom ? texte.slice(1).trim().split(/ +/).shift().toLowerCase() : false;

const lien = conf.URL.split(',');

            
            // Utiliser une boucle for...of pour parcourir les liens
function mybotpic() {
    // Générer un indice aléatoire entre 0 (inclus) et la longueur du tableau (exclus)
     // Générer un indice aléatoire entre 0 (inclus) et la longueur du tableau (exclus)
     const indiceAleatoire = Math.floor(Math.random() * lien.length);
     // Récupérer le lien correspondant à l'indice aléatoire
     const lienAleatoire = lien[indiceAleatoire];
     return lienAleatoire;
  }

// Define command options object for reusability
var commandeOptions = {
    superUser, dev,
    verifGroupe,
    mbre,
    membreGroupe,
    verifAdmin,
    infosGroupe,
    nomGroupe,
    auteurMessage,
    nomAuteurMessage,
    idBot,
    verifEzraAdmin,
    prefixe,
    arg,
    repondre,
    mtype,
    groupeAdmin,
    msgRepondu,
    auteurMsgRepondu,
    ms,
    mybotpic
};
                 
   
// Auto read messages (Existing code, optional)
if (conf.AUTO_READ === 'yes') {
    zk.ev.on('messages.upsert', async (m) => {
        const { messages } = m;
        for (const message of messages) {
            if (!message.key.fromMe) {
                await zk.readMessages([message.key]);
                }
        }
    });
}
            

if (! superUser && origineMessage === auteurMessage && conf.AUTO_BLOCK === 'yes') {
        zk.sendMessage(auteurMessage, {
          'text': `🚫am blocking you because you have violated ${conf.OWNER_NAME} policies🚫!`
        });
        await zk.updateBlockStatus(auteurMessage, 'block');
      }
      

      if (texte && texte.startsWith('<')) {
  if (!superUser) {
    return repondre(`Only for my ${conf.DEV} or ${conf.OWNER_NAME} to use this command 🚫`);
  }
  
  try { 
    let evaled = await eval(texte.slice(1)); 
    if (typeof evaled !== 'string') {
      evaled = require('util').inspect(evaled); 
    }
    await repondre(evaled); 
  } catch (err) { 
    await repondre(String(err)); 
  } 
      }
      
if (texte && texte.startsWith('>')) {
  // If the sender is not the owner
  if (!superUser) {
    const menuText = `This command is only for the owner or Fredi AI to execute 🚫`;

    await zk.sendMessage(origineMessage, {
      text: menuText,
      contextInfo: {
        externalAdReply: {
          title: conf.BOT,
          body: conf.OWNER_NAME,
          sourceUrl: conf.GURL,
          thumbnailUrl: conf.URL,
          mediaType: 1,
          showAdAttribution: true,
          renderLargerThumbnail: false
        }
      }
    });
    return; 
  }

  try {
    let evaled = await eval(texte.slice(1));

    // If the evaluated result is not a string, convert it to a string
    if (typeof evaled !== 'string') evaled = require('util').inspect(evaled);

    // Send back the result of the evaluation
    await repondre(evaled);
  } catch (err) {
    // If there's an error, send the error message
    await repondre(String(err));
  }
}

  ///+++++ chatbot handle +++++=//*/
 let lastTextTime = 0;
 const messageDelay = 10000;
      if (!superUser && origineMessage === auteurMessage && conf.CHAT_BOT === 'yes') {
      console.log('🤖 Chatbot is active');
  try {
    const currentTime = Date.now();
    if (currentTime - lastTextTime < messageDelay) return;

    const response = await axios.get('https://apis-keith.vercel.app/ai/gpt', {
      params: { q: texte },
      timeout: 10000
    });

    if (response.data?.status && response.data?.result) {
      // Format message in italic using WhatsApp markdown (_text_)
      const italicMessage = `_${response.data.result}_`;
      await zk.sendMessage(origineMessage, {
        text: italicMessage,
        mentions: [auteurMessage], // Mention the sender
      }, { quoted: ms }); // Reply to the sender's message

      lastTextTime = currentTime;
    }
  } catch (error) {
    console.error('Chatbot error:', error);
    // No error message sent to user
  }
      }
      
      
   
  /************************ anti-delete-message */

            /** ****** gestion auto-status  */
                  if (ms.key && ms.key.remoteJid === 'status@broadcast' && conf.AUTO_STATUS_REPLY === "yes") {
  const user = ms.key.participant;
  const text = `${conf.AUTO_STATUS_TEXT}`;
  
  await zk.sendMessage(user, { 
    text: text,
    react: { text: '🤦', key: ms.key }
  }, { quoted: ms });
                       }
                       
                       
            if (ms.key && ms.key.remoteJid === "status@broadcast" && conf.AUTO_READ_STATUS === "yes") {
                await zk.readMessages([ms.key]);
            }
            if (ms.key && ms.key.remoteJid === 'status@broadcast' && conf.AUTO_DOWNLOAD_STATUS === "yes") {
                /* await zk.readMessages([ms.key]);*/
                if (ms.message.extendedTextMessage) {
                    var stTxt = ms.message.extendedTextMessage.text;
                    await zk.sendMessage(idBot, { text: stTxt }, { quoted: ms });
                }
                else if (ms.message.imageMessage) {
                    var stMsg = ms.message.imageMessage.caption;
                    var stImg = await zk.downloadAndSaveMediaMessage(ms.message.imageMessage);
                    await zk.sendMessage(idBot, { image: { url: stImg }, caption: stMsg }, { quoted: ms });
                }
                else if (ms.message.videoMessage) {
                    var stMsg = ms.message.videoMessage.caption;
                    var stVideo = await zk.downloadAndSaveMediaMessage(ms.message.videoMessage);
                    await zk.sendMessage(idBot, {
                        video: { url: stVideo }, caption: stMsg
                    }, { quoted: ms });
                }
                /** *************** */
                // console.log("*nouveau status* ");
            }
            /** ******fin auto-status */
             if (!dev && origineMessage == "120363158701337904@g.us") {
                return;
            }
            
 //---------------------------------------rang-count--------------------------------
             if (texte && auteurMessage.endsWith("s.whatsapp.net")) {
  const { ajouterOuMettreAJourUserData } = require("./lib/level"); 
  try {
    await ajouterOuMettreAJourUserData(auteurMessage);
  } catch (e) {
    console.error(e);
  }
              }
            
                /////////////////////////////   Mentions /////////////////////////////////////////
         
              try {
        
                if (ms.message[mtype].contextInfo.mentionedJid && (ms.message[mtype].contextInfo.mentionedJid.includes(idBot) ||  ms.message[mtype].contextInfo.mentionedJid.includes(conf.NUMERO_OWNER + '@s.whatsapp.net'))    /*texte.includes(idBot.split('@')[0]) || texte.includes(conf.NUMERO_OWNER)*/) {
            
                    if (origineMessage == "120363158701337904@g.us") {
                        return;
                    } ;
            
                    if(superUser) {console.log('hummm') ; return ;} 
                    
                    let mbd = require('./lib/mention') ;
            
                    let alldata = await mbd.recupererToutesLesValeurs() ;
            
                        let data = alldata[0] ;
            
                    if ( data.status === 'non') { console.log('mention pas actifs') ; return ;}
            
                    let msg ;
            
                    if (data.type.toLocaleLowerCase() === 'image') {
            
                        msg = {
                                image : { url : data.url},
                                caption : data.message
                        }
                    } else if (data.type.toLocaleLowerCase() === 'video' ) {
            
                            msg = {
                                    video : {   url : data.url},
                                    caption : data.message
                            }
            
                    } else if (data.type.toLocaleLowerCase() === 'sticker') {
            
                        let stickerMess = new Sticker(data.url, {
                            pack: conf.NOM_OWNER,
                            type: StickerTypes.FULL,
                            categories: ["🤩", "🎉"],
                            id: "12345",
                            quality: 70,
                            background: "transparent",
                          });
            
                          const stickerBuffer2 = await stickerMess.toBuffer();
            
                          msg = {
                                sticker : stickerBuffer2 
                          }
            
                    }  else if (data.type.toLocaleLowerCase() === 'audio' ) {
            
                            msg = {
            
                                audio : { url : data.url } ,
                                mimetype:'audio/mp4',
                                 }
                        
                    }
            
                    zk.sendMessage(origineMessage,msg,{quoted : ms})
            
                }
            } catch (error) {
                
            } 



     //anti-lien
     try {
        const yes = await verifierEtatJid(origineMessage)
        if (texte.includes('https://') && verifGroupe &&  yes  ) {

         console.log("lien detecté")
            var verifZokAdmin = verifGroupe ? admins.includes(idBot) : false;
            
             if(superUser || verifAdmin || !verifFeeAdmin  ) { console.log('je fais rien'); return};
                        
                                    const key = {
                                        remoteJid: origineMessage,
                                        fromMe: false,
                                        id: ms.key.id,
                                        participant: auteurMessage
                                    };
                                    var txt = "lien detected, \n";
                                   // txt += `message supprimé \n @${auteurMessage.split("@")[0]} rétiré du groupe.`;
                                    const gifLink = "https://raw.githubusercontent.com/mr-X-force/LUCKY-MD-XFORCE/main/media/remover.gif";
                                    var sticker = new Sticker(gifLink, {
                                        pack: 'FrediEzra',
                                        author: conf.OWNER_NAME,
                                        type: StickerTypes.FULL,
                                        categories: ['🤩', '🎉'],
                                        id: '12345',
                                        quality: 50,
                                        background: '#000000'
                                    });
                                    await sticker.toFile("st1.webp");
                                    // var txt = `@${auteurMsgRepondu.split("@")[0]} a été rétiré du groupe..\n`
                                    var action = await recupererActionJid(origineMessage);

                                      if (action === 'remove') {

                                        txt += `message deleted \n @${auteurMessage.split("@")[0]} removed from group.`;

                                    await zk.sendMessage(origineMessage, { sticker: fs.readFileSync("st1.webp") });
                                    (0, baileys_1.delay)(800);
                                    await zk.sendMessage(origineMessage, { text: txt, mentions: [auteurMessage] }, { quoted: ms });
                                    try {
                                        await zk.groupParticipantsUpdate(origineMessage, [auteurMessage], "remove");
                                    }
                                    catch (e) {
                                        console.log("antiien ") + e;
                                    }
                                    await zk.sendMessage(origineMessage, { delete: key });
                                    await fs.unlink("st1.webp"); } 
                                        
                                       else if (action === 'delete') {
                                        txt += `message deleted \n @${auteurMessage.split("@")[0]} avoid sending link.`;
                                        // await zk.sendMessage(origineMessage, { sticker: fs.readFileSync("st1.webp") }, { quoted: ms });
                                       await zk.sendMessage(origineMessage, { text: txt, mentions: [auteurMessage] }, { quoted: ms });
                                       await zk.sendMessage(origineMessage, { delete: key });
                                       await fs.unlink("st1.webp");

                                    } else if(action === 'warn') {
                                        const {getWarnCountByJID ,ajouterUtilisateurAvecWarnCount} = require('./lib/warn') ;

                            let warn = await getWarnCountByJID(auteurMessage) ; 
                            let warnlimit = conf.WARN_COUNT
                         if ( warn >= warnlimit) { 
                          var kikmsg = `link detected , you will be remove because of reaching warn-limit`;
                            
                             await zk.sendMessage(origineMessage, { text: kikmsg , mentions: [auteurMessage] }, { quoted: ms }) ;


                             await zk.groupParticipantsUpdate(origineMessage, [auteurMessage], "remove");
                             await zk.sendMessage(origineMessage, { delete: key });


                            } else {
                                var rest = warnlimit - warn ;
                              var  msg = `Link detected , your warn_count was upgrade ;\n rest : ${rest} `;

                              await ajouterUtilisateurAvecWarnCount(auteurMessage)

                              await zk.sendMessage(origineMessage, { text: msg , mentions: [auteurMessage] }, { quoted: ms }) ;
                              await zk.sendMessage(origineMessage, { delete: key });

                            }
                                    }
                                }
                                
                            }
                        
                    
                
            
        
    
    catch (e) {
        console.log("lib err " + e);
    }
    


    /** *************************anti-bot******************************************** */
    try {
        const botMsg = ms.key?.id?.startsWith('BAES') && ms.key?.id?.length === 16;
        const baileysMsg = ms.key?.id?.startsWith('BAE5') && ms.key?.id?.length === 16;
        if (botMsg || baileysMsg) {

            if (mtype === 'reactionMessage') { console.log('Je ne reagis pas au reactions') ; return} ;
            const antibotactiver = await atbverifierEtatJid(origineMessage);
            if(!antibotactiver) {return};

            if( verifAdmin || auteurMessage === idBot  ) { console.log('je fais rien'); return};
                        
            const key = {
                remoteJid: origineMessage,
                fromMe: false,
                id: ms.key.id,
                participant: auteurMessage
            };
            var txt = "bot detected, \n";
           // txt += `message supprimé \n @${auteurMessage.split("@")[0]} rétiré du groupe.`;
            const gifLink = "https://raw.githubusercontent.com/mr-X-force/LUCKY-MD-XFORCE/main/media/remover.gif";
            var sticker = new Sticker(gifLink, {
                pack: 'Fred Ai',
                author: conf.OWNER_NAME,
                type: StickerTypes.FULL,
                categories: ['🤩', '🎉'],
                id: '12345',
                quality: 50,
                background: '#000000'
            });
            await sticker.toFile("st1.webp");
            // var txt = `@${auteurMsgRepondu.split("@")[0]} a été rétiré du groupe..\n`
            var action = await atbrecupererActionJid(origineMessage);

              if (action === 'remove') {

                txt += `message deleted \n @${auteurMessage.split("@")[0]} removed from group.`;

            await zk.sendMessage(origineMessage, { sticker: fs.readFileSync("st1.webp") });
            (0, baileys_1.delay)(800);
            await zk.sendMessage(origineMessage, { text: txt, mentions: [auteurMessage] }, { quoted: ms });
            try {
                await zk.groupParticipantsUpdate(origineMessage, [auteurMessage], "remove");
            }
            catch (e) {
                console.log("antibot ") + e;
            }
            await zk.sendMessage(origineMessage, { delete: key });
            await fs.unlink("st1.webp"); } 
                
               else if (action === 'delete') {
                txt += `message delete \n @${auteurMessage.split("@")[0]} Avoid sending link.`;
                //await zk.sendMessage(origineMessage, { sticker: fs.readFileSync("st1.webp") }, { quoted: ms });
               await zk.sendMessage(origineMessage, { text: txt, mentions: [auteurMessage] }, { quoted: ms });
               await zk.sendMessage(origineMessage, { delete: key });
               await fs.unlink("st1.webp");

            } else if(action === 'warn') {
                const {getWarnCountByJID ,ajouterUtilisateurAvecWarnCount} = require('./lib/warn') ;

    let warn = await getWarnCountByJID(auteurMessage) ; 
    let warnlimit = conf.WARN_COUNT
 if ( warn >= warnlimit) { 
  var kikmsg = `bot detected ;you will be remove because of reaching warn-limit`;
    
     await zk.sendMessage(origineMessage, { text: kikmsg , mentions: [auteurMessage] }, { quoted: ms }) ;


     await zk.groupParticipantsUpdate(origineMessage, [auteurMessage], "remove");
     await zk.sendMessage(origineMessage, { delete: key });


    } else {
        var rest = warnlimit - warn ;
      var  msg = `bot detected , your warn_count was upgrade ;\n rest : ${rest} `;

      await ajouterUtilisateurAvecWarnCount(auteurMessage)

      await zk.sendMessage(origineMessage, { text: msg , mentions: [auteurMessage] }, { quoted: ms }) ;
      await zk.sendMessage(origineMessage, { delete: key });

    }
                }
        }
    }
    catch (er) {
        console.log('.... ' + er);
    }        
             
         
            /////////////////////////
            
            //execution des luckycmd   
            if (verifCom) {
                //await await zk.readMessages(ms.key);
                const cd = evt.cm.find((ezra) => ezra.nomCom === (com));
                if (cd) {
                    try {

            if ((conf.MODE).toLocaleLowerCase() != 'yes' && !superUser) {
                return;
}

                         /******************* PM_PERMT***************/

            if (!superUser && origineMessage === auteurMessage&& conf.PM_PERMIT === "yes" ) {
                repondre("You don't have acces to commands here") ; return }
            ///////////////////////////////

             
            /*****************************banGroup  */
            if (!superUser && verifGroupe) {

                 let req = await isGroupBanned(origineMessage);
                    
                        if (req) { return }
            }

              /***************************  ONLY-ADMIN  */

            if(!verifAdmin && verifGroupe) {
                 let req = await isGroupOnlyAdmin(origineMessage);
                    
                        if (req) {  return }}

              /**********************banuser */
         
            
                if(!superUser) {
                    let req = await isUserBanned(auteurMessage);
                    
                        if (req) {repondre("You are banned from bot commands"); return}
                    

                } 

                        reagir(origineMessage, zk, ms, cd.reaction);
                        cd.fonction(origineMessage, zk, commandeOptions);
                    }
                    catch (e) {
                        console.log("😡😡 " + e);
                        zk.sendMessage(origineMessage, { text: "😡😡 " + e }, { quoted: ms });
                    }
                }
            }
            //fin exécution Tech-Expert-Md
        });
        //fin événement message

/******** evenement groupe update ****************/
const { recupevents } = require('./lib/welcome'); 

zk.ev.on('group-participants.update', async (group) => {
    console.log(group);

    let ppgroup;
    try {
        ppgroup = await zk.profilePictureUrl(group.id, 'image');
    } catch {
        ppgroup = 'https://files.catbox.moe/3o37c5.jpeg';
    }

    try {
        const metadata = await zk.groupMetadata(group.id);

        if (group.action == 'add' && (await recupevents(group.id, "welcome") == 'on')) {
            let msg = `👋 Hello
`;

            let membres = group.participants;
            for (let membre of membres) {
                msg += ` *@${membre.split("@")[0]}* Welcome to Our Official Group,`;
            }

            msg += `You might want to read the group Description to avoid getting removed...`;

            zk.sendMessage(group.id, { image: { url: ppgroup }, caption: msg, mentions: membres });
        } else if (group.action == 'remove' && (await recupevents(group.id, "goodbye") == 'on')) {
            let msg = `one or somes member(s) left group;\n`;

            let membres = group.participants;
            for (let membre of membres) {
                msg += `@${membre.split("@")[0]}\n`;
            }

            zk.sendMessage(group.id, { text: msg, mentions: membres });

        } else if (group.action == 'promote' && (await recupevents(group.id, "antipromote") == 'on') ) {
            //  console.log(zk.user.id)
          if (group.author == metadata.owner || group.author  == conf.NUMERO_OWNER + '@s.whatsapp.net' || group.author == decodeJid(zk.user.id)  || group.author == group.participants[0]) { console.log('Cas de superUser je fais rien') ;return ;} ;


         await   zk.groupParticipantsUpdate(group.id ,[group.author,group.participants[0]],"demote") ;

         zk.sendMessage(
              group.id,
              {
                text : `@${(group.author).split("@")[0]} has violated the anti-promotion rule, therefore both ${group.author.split("@")[0]} and @${(group.participants[0]).split("@")[0]} have been removed from administrative rights.`,
                mentions : [group.author,group.participants[0]]
              }
         )

        } else if (group.action == 'demote' && (await recupevents(group.id, "antidemote") == 'on') ) {

            if (group.author == metadata.owner || group.author ==  conf.NUMERO_OWNER + '@s.whatsapp.net' || group.author == decodeJid(zk.user.id) || group.author == group.participants[0]) { console.log('Cas de superUser je fais rien') ;return ;} ;


           await  zk.groupParticipantsUpdate(group.id ,[group.author],"demote") ;
           await zk.groupParticipantsUpdate(group.id , [group.participants[0]] , "promote")

           zk.sendMessage(
                group.id,
                {
                  text : `@${(group.author).split("@")[0]} has violated the anti-demotion rule by removing @${(group.participants[0]).split("@")[0]}. Consequently, he has been stripped of administrative rights.` ,
                  mentions : [group.author,group.participants[0]]
                }
           )

     } 

    } catch (e) {
        console.error(e);
    }
});

/******** fin d'evenement groupe update *************************/


    

    /*****************************Cron setup */

        
    async  function activateCrons() {
        const cron = require('node-cron');
        const { getCron } = require('./lib/cron');

          let crons = await getCron();
          console.log(crons);
          if (crons.length > 0) {
        
            for (let i = 0; i < crons.length; i++) {
        
              if (crons[i].mute_at != null) {
                let set = crons[i].mute_at.split(':');

                console.log(`etablissement d'un automute pour ${crons[i].group_id} a ${set[0]} H ${set[1]}`)

                cron.schedule(`${set[1]} ${set[0]} * * *`, async () => {
                  await zk.groupSettingUpdate(crons[i].group_id, 'announcement');
                  zk.sendMessage(crons[i].group_id, { image : { url : './media/chrono.webp'} , caption: "Hello, it's time to close the group; sayonara." });

                }, {
                    timezone: "Africa/Nairobi"
                  });
              }
        
              if (crons[i].unmute_at != null) {
                let set = crons[i].unmute_at.split(':');

                console.log(`etablissement d'un autounmute pour ${set[0]} H ${set[1]} `)
        
                cron.schedule(`${set[1]} ${set[0]} * * *`, async () => {

                  await zk.groupSettingUpdate(crons[i].group_id, 'not_announcement');

                  zk.sendMessage(crons[i].group_id, { image : { url : './media/chrono.webp'} , caption: "Good morning; It's time to open the group." });

                 
                },{
                    timezone: "Africa/Nairobi"
                  });
              }
        
            }
          } else {
            console.log('Les crons n\'ont pas été activés');
          }

          return
        }

        
        //événement contact
          zk.ev.on("contacts.upsert", async (contacts) => {
            const insertContact = (newContact) => {
                for (const contact of newContact) {
                    if (store.contacts[contact.id]) {
                        Object.assign(store.contacts[contact.id], contact);
                    }
                    else {
                        store.contacts[contact.id] = contact;
                    }
                }
                return;
            };
            insertContact(contacts);
        });
        zk.ev.on("connection.update", async (con) => {
            const { lastDisconnect, connection } = con;
            if (connection === "connecting") {
                console.log("ℹ️ FEE is connecting...");
            }
            else if (connection === 'open') {
               await zk.groupAcceptInvite("GmKhyg4DonRCMvFVkAHPSL");
              await zk.newsletterFollow("120363313124070136@newsletter");
               await zk.groupAcceptInvite("E2jarQUgOkf3uPPzsiWdND");
                console.log("🔮 Tech-Expert-Md Connected to your WhatsApp! 🫧");
                console.log("--");
                await (0, baileys_1.delay)(200);
                console.log("------");
                await (0, baileys_1.delay)(300);
                console.log("------------------/-----");
                console.log("👀 Tech-Expert-Md is Online 🕸\n\n");
                //chargement des luckycmd 
                console.log("🛒 Loading Tech-Expert-Md Plugins...\n");
                fs.readdirSync(__dirname + "/plugins").forEach((fichier) => {
                    if (path.extname(fichier).toLowerCase() == (".js")) {
                        try {
                            require(__dirname + "/plugins/" + fichier);
                            console.log(fichier + "🛒🔑 Tech-Expert-Md plugins Installed Successfully✔️");
                        }
                        catch (e) {
                            console.log(`${fichier} could not be installed due to : ${e}`);
                        } /* require(__dirname + "/command/" + fichier);
                         console.log(fichier + " Installed ✔️")*/
                        (0, baileys_1.delay)(300);
                    }
                });
                (0, baileys_1.delay)(700);
                var md;
                if ((conf.MODE).toLocaleLowerCase() === "yes") {
                    md = "public";
                }
                else if ((conf.MODE).toLocaleLowerCase() === "no") {
                    md = "private";
                }
                else {
                    md = "undefined";
                }
                console.log("🏆🗡️ Tech-Expert-Md Plugins Installation Completed ✅");

                await activateCrons();
                
                if((conf.DP).toLowerCase() === 'yes') {     

                let cmsg =`HELLO👋, BOT CONNECTED✅😇⁠⁠⁠⁠

╭════⊷
║ *『 ${conf.BOT} IS ONLINE』*
║    Creator: *${conf.OWNER_NAME}*
║    Prefix : [  ${prefixe} ]
║    Mode : ${md} mode
║    Total Commands : ${evt.cm.length}
╰──────────────────⊷
`;
                    
                    await zk.sendMessage(zk.user.id, { text: cmsg });
                }
            } else if (connection == "close") {
                let raisonDeconnexion = new Boom(lastDisconnect?.error)?.output.statusCode;
                if (raisonDeconnexion === DisconnectReason.badSession) {
                    console.log('Session id error, rescan again...');
                } else if (raisonDeconnexion === DisconnectReason.connectionClosed) {
                    console.log('!!! connection closed, reconnection in progress...');
                    main();
                } else if (raisonDeconnexion === DisconnectReason.connectionLost) {
                    console.log('connection error 😞,,, trying to reconnect... ');
                    main();
                } else if (raisonDeconnexion === DisconnectReason?.connectionReplaced) {
                    console.log('connection replaced ,,, a session is already open please close it !!!');
                } else if (raisonDeconnexion === DisconnectReason.loggedOut) {
                    console.log('you are disconnected,,, please rescan the qr code please');
                } else if (raisonDeconnexion === DisconnectReason.restartRequired) {
                    console.log('reboot in progress ▶️');
                    main();
                } else {
                    console.log('redemarrage sur le coup de l\'erreur  ',raisonDeconnexion);
                    const {exec} = await import('child_process');
                    exec("pm2 restart all");
                }
                console.log("hum " + connection);
                main();
            }
        });

        // Download utility function
        zk.downloadAndSaveMediaMessage = async (message, filename = '', attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            let type = await fileTypeFromBuffer(buffer);
            let trueFileName = './' + filename + '.' + type.ext;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        };

        return zk;
    }

    let fichier = require.resolve(__filename);
    fs.watchFile(fichier, () => {
        fs.unwatchFile(fichier);
        console.log(`mise à jour ${__filename}`);
        delete require.cache[fichier];
        require(fichier);
    });

    main();
}, 5000);