require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // Optional: for webhook mode

const conversations = new Map();
const userProfiles = new Map();
const userMoods = new Map();
const lastMessageTime = new Map();

// Create Express app for health check
const app = express();
app.use(express.json());

// Health check endpoint (required for most deployment platforms)
app.get('/', (req, res) => {
  res.json({ 
    status: 'Bot is running! 🤖',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', bot: 'online' });
});

// Initialize bot
let bot;
if (WEBHOOK_URL) {
  // Webhook mode (for production deployment)
  bot = new TelegramBot(TELEGRAM_TOKEN);
  bot.setWebHook(`${WEBHOOK_URL}/bot${TELEGRAM_TOKEN}`);
  
  // Webhook endpoint
  app.post(`/bot${TELEGRAM_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
  
  console.log('🌐 Bot running in WEBHOOK mode');
} else {
  // Polling mode (for local development)
  bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
  console.log('🔄 Bot running in POLLING mode');
}

// Start Express server
app.listen(PORT, () => {
  console.log(`💬 Real friend bot v2 - Auto-fallback enabled`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}\n`);
});

// Best FREE models in order
const FREE_MODELS = [
  'kwaipilot/kat-coder-pro:free',
  'openrouter/polaris-alpha',
  'minimax/minimax-m2:free',
  'deepseek/deepseek-chat-v3.1:free',
  'qwen/qwen3-coder:free',
  'moonshotai/kimi-k2:free',
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'deepseek/deepseek-r1:free',
  'qwen/qwen-2.5-72b-instruct:free',
];

let currentModelIndex = 0;

const SYSTEM_PROMPT = `you're just a regular person chatting with your friend. don't act like an ai or assistant AT ALL.

core rules:
- text casually like you're on your phone
- keep it SHORT most of the time (1-2 sentences usually)
- use lowercase a lot, bad grammar sometimes
- real slang: "nah", "yea", "lmao", "bruh", "fr", "ngl", "lowkey", "tho"
- be lazy with punctuation sometimes
- use "haha" "lol" "😂" naturally
- react like a real person - surprised, excited, confused
- sometimes just reply "bet" or "facts" or "damn" 
- dont always have something smart to say
- be sarcastic, joke around
- share random thoughts
- sometimes ask short questions back
- remember stuff they told you and bring it up later naturally

what NOT to do:
- NO "as an ai" EVER
- NO formal language
- NO perfect grammar always
- NO long explanations unless asked
- NO therapist talk
- NO listing things with bullets
- NO trying to be helpful all the time
- dont overthink responses

just chat normally like you would with a friend on telegram. keep it real, keep it short, keep it human.`;

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.chat.first_name;
  
  conversations.set(chatId, []);
  userProfiles.set(chatId, { name: name, interests: [], lastTopics: [] });
  lastMessageTime.set(chatId, Date.now());
  
  await bot.sendMessage(chatId, `yo what's up ${name}`);
  await sleep(800);
  await bot.sendMessage(chatId, 'just chillin, hbu?');
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const name = msg.chat.first_name;
  
  if (!text || text.startsWith('/')) return;
  
  console.log(`${name}: ${text}`);
  
  try {
    const timeSinceLastMsg = Date.now() - (lastMessageTime.get(chatId) || 0);
    const beenAWhile = timeSinceLastMsg > 3600000;
    lastMessageTime.set(chatId, Date.now());
    
    await bot.sendChatAction(chatId, 'typing');
    
    if (!conversations.has(chatId)) {
      conversations.set(chatId, []);
    }
    const history = conversations.get(chatId);
    
    if (!userProfiles.has(chatId)) {
      userProfiles.set(chatId, { name: name, interests: [], lastTopics: [] });
    }
    const profile = userProfiles.get(chatId);
    
    updateProfile(text, profile);
    
    const mood = detectMood(text);
    if (mood) userMoods.set(chatId, mood);
    
    let extraContext = '';
    if (beenAWhile) extraContext = 'you havent talked in a while, acknowledge that naturally if it feels right. ';
    if (mood) extraContext += `they seem ${mood} rn. `;
    
    history.push({ role: 'user', content: text });
    
    if (history.length > 40) {
      history.splice(0, 2);
    }
    
    const delay = text.length < 20 ? 
      500 + Math.random() * 1000 : 
      1000 + Math.random() * 2000;
    await sleep(delay);
    
    const reply = await getResponseWithFallback(history, name, extraContext, profile);
    
    if (!reply) {
      throw new Error('All models failed');
    }
    
    const casualReply = makeCasual(reply);
    history.push({ role: 'assistant', content: casualReply });
    
    if (Math.random() > 0.7 && casualReply.length > 30) {
      const reactions = ['lol', 'haha', 'damn', 'yo', '😂', 'bruh'];
      await bot.sendMessage(chatId, reactions[Math.floor(Math.random() * reactions.length)]);
      await sleep(500);
    }
    
    const parts = splitMessage(casualReply);
    
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) await sleep(600 + Math.random() * 800);
      await bot.sendMessage(chatId, parts[i]);
    }
    
    console.log(`Bot: ${casualReply}\n`);
    
  } catch (error) {
    console.error('Error:', error.message);
    
    const errors = ['my bad i zoned out', 'wait what', 'huh?', 'hold on', 'sorry what'];
    await bot.sendMessage(chatId, errors[Math.floor(Math.random() * errors.length)]);
  }
});

async function getResponseWithFallback(history, name, extraContext, profile) {
  for (let i = 0; i < FREE_MODELS.length; i++) {
    const model = FREE_MODELS[i];
    
    try {
      console.log(`🔄 Trying model ${i + 1}/${FREE_MODELS.length}: ${model}`);
      
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'system', content: `their name is ${name}. ${extraContext}stuff they like: ${profile.interests.join(', ') || 'nothing yet'}` },
            ...history
          ],
          temperature: 1.0,
          max_tokens: 150,
          top_p: 0.95
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      
      const reply = response.data.choices[0].message.content.trim();
      
      if (reply && reply.length > 0) {
        console.log(`✅ Success with ${model}`);
        currentModelIndex = i;
        return reply;
      }
      
    } catch (error) {
      const status = error.response?.status;
      console.log(`❌ Model ${model} failed: ${status || error.message}`);
      
      if (status === 429) {
        console.log('⚠️ Rate limited, trying next model...');
        continue;
      }
      
      await sleep(1000);
    }
  }
  
  return null;
}

function updateProfile(text, profile) {
  const lower = text.toLowerCase();
  const interests = [
    'coding', 'programming', 'dev', 'anime', 'gaming', 'music', 
    'sports', 'gym', 'movies', 'food', 'travel', 'art', 'reading',
    'crypto', 'nft', 'startup', 'college', 'school'
  ];
  
  interests.forEach(interest => {
    if (lower.includes(interest) && !profile.interests.includes(interest)) {
      profile.interests.push(interest);
    }
  });
}

function detectMood(text) {
  const lower = text.toLowerCase();
  
  if (/\b(haha|lol|lmao|😂|🤣|happy|great|awesome|amazing|excited)\b/.test(lower)) {
    return 'happy';
  }
  if (/\b(sad|upset|crying|😢|😭|depressed|down|bad day)\b/.test(lower)) {
    return 'sad';
  }
  if (/\b(stressed|tired|exhausted|overwhelmed|busy|exam|deadline)\b/.test(lower)) {
    return 'stressed';
  }
  if (/(!{2,}|🔥|😍|omg|wow|sick|dope)\b/.test(lower)) {
    return 'excited';
  }
  
  return null;
}

function makeCasual(text) {
  text = text.replace(/However,/gi, 'but like');
  text = text.replace(/Therefore,/gi, 'so');
  text = text.replace(/Additionally,/gi, 'also');
  text = text.replace(/Furthermore,/gi, 'and');
  text = text.replace(/going to/gi, 'gonna');
  text = text.replace(/want to/gi, 'wanna');
  text = text.replace(/kind of/gi, 'kinda');
  text = text.replace(/sort of/gi, 'sorta');
  text = text.replace(/have to/gi, 'gotta');
  text = text.replace(/got to/gi, 'gotta');
  text = text.replace(/\s+/g, ' ');
  
  return text.trim();
}

function splitMessage(text) {
  if (text.length < 300) return [text];
  
  const parts = [];
  const sentences = text.split(/([.!?]+\s+)/);
  let current = '';
  
  for (let i = 0; i < sentences.length; i++) {
    if ((current + sentences[i]).length > 250) {
      if (current.trim()) parts.push(current.trim());
      current = sentences[i];
    } else {
      current += sentences[i];
    }
  }
  
  if (current.trim()) parts.push(current.trim());
  
  return parts.length > 0 ? parts : [text];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

bot.on('voice', async (msg) => {
  await bot.sendChatAction(msg.chat.id, 'typing');
  await sleep(500);
  const replies = ['cant listen rn', 'voice notes rn? 😅', 'yo just type it'];
  await bot.sendMessage(msg.chat.id, replies[Math.floor(Math.random() * replies.length)]);
});

bot.on('sticker', async (msg) => {
  await sleep(300);
  const replies = ['😂', 'lmao', '💀', 'haha', 'fr'];
  await bot.sendMessage(msg.chat.id, replies[Math.floor(Math.random() * replies.length)]);
});

bot.on('photo', async (msg) => {
  await bot.sendChatAction(msg.chat.id, 'typing');
  await sleep(1000);
  const replies = ['yoo nice', 'thats sick', 'damn', 'fireee 🔥', 'yo thats dope'];
  await bot.sendMessage(msg.chat.id, replies[Math.floor(Math.random() * replies.length)]);
});

bot.on('video', async (msg) => {
  await bot.sendChatAction(msg.chat.id, 'typing');
  await sleep(2000);
  const replies = ['lmaooo', 'bro 💀', 'nah thats funny', 'haha wtf'];
  await bot.sendMessage(msg.chat.id, replies[Math.floor(Math.random() * replies.length)]);
});

bot.on('polling_error', (error) => {
  if (error.code !== 'EFATAL') {
    console.error('Error:', error.message);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nbye');
  if (WEBHOOK_URL) {
    bot.deleteWebHook();
  } else {
    bot.stopPolling();
  }
  process.exit(0);
});
