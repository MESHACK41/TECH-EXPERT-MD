import { watchFile, unwatchFile } from 'fs' 
import chalk from 'chalk'
import { fileURLToPath } from 'url'
import fs from 'fs'
import cheerio from 'cheerio'
import fetch from 'node-fetch'
import axios from 'axios'
import moment from 'moment-timezone' 

//*─────────────────────────────*

//BETA: If you want to avoid typing the number that will be the bot in the console, add it here:
//Only applies for option 2 (being a bot with 8-digit text code)
global.botNumber = '' //Example: 255711389698

//*─────────────────────────────*

global.owner = [
// <-- Number @s.whatsapp.net -->
  ['255711389698', 'TECH-EXPERT', true],
  ['255711389698', 'TECH-EXPERT', true],
  
// <-- Number @lid -->
  ['', 'TECH-EXPERT', true],
  ['', '', true], 
  ['', '', true]
];

//*─────────────────────────────*

global.mods = []
global.suittag = ['255711389698'] 
global.prems = []

//*─────────────────────────────*

global.library = 'Baileys'
global.baileys = 'V 6.7.17' 
global.vs = '2.2.5'
global.nameqr = 'TECH-EXPERT'
global.namebot = 'TECH-EXPERT'
global.sessions = 'session'
global.jadi = 'JadiBots' 
global.yukiJadibts = true

//*─────────────────────────────*

global.packname = '⪛✰ TECH-EXPERT ✰⪜'
global.botname = 'TECH-EXPERT'
global.wm = '✿◟TECH-EXPERT◞✿'
global.author = 'Made With By Tech expertTeam'
global.dev = '© Powered By Tech ExpertTeam'
global.textbot = 'MR TECH EXPERT'
global.tag = 'TECH-EXPERT'

//*─────────────────────────────*

global.currency = 'TECH-EXPERT'
global.welcome1 = '❍ Edit With The Command setwelcome'
global.welcome2 = '❍ Edit With The Command setbye'
global.banner = 'https://imgur.com/a/zXWVpGK'
global.avatar = 'https://imgur.com/a/zXWVpGK'

//*─────────────────────────────*

global.gp1 = 'https://chat.whatsapp.com/K0ATMxcydZj0civwVVjvcu'
global.community1 = 'https://whatsapp.com/channel/0029VbA1jdkDp2QAvGIIrL0m'
global.channel = 'https://whatsapp.com/channel/0029VbA1jdkDp2QAvGIIrL0m'
global.channel2 = 'https://whatsapp.com/channel/0029VbA1jdkDp2QAvGIIrL0m'
global.md = 'https://github.com/MESHACK41/TECH-EXPERT-MD'
global.email = 'mrtechexpert07@gmail.com'

//*─────────────────────────────*

global.catalog = fs.readFileSync('https://imgur.com/a/zXWVpGK');
global.style = { key: {  fromMe: false, participant: `0@s.whatsapp.net`, ...(false ? { remoteJid: "@g.us" } : {}) }, message: { orderMessage: { itemCount : -999999, status: 1, surface : 1, message: packname, orderTitle: 'Bang', thumbnail: catalog, sellerJid: '0@s.whatsapp.net'}}}
global.ch = {
ch1: '120363321705798318@newsletter',
}
global.multiplier = 60

//*─────────────────────────────*

global.cheerio = cheerio
global.fs = fs
global.fetch = fetch
global.axios = axios
global.moment = moment   

//*─────────────────────────────*

let file = fileURLToPath(import.meta.url)
watchFile(file, () => {
  unwatchFile(file)
  console.log(chalk.redBright("Update 'settings.js'"))
  import(`${file}?update=${Date.now()}`)
})
