require('dotenv').config();
const { Client, Intents } = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB подключен'))
  .catch(err => console.error('❌ Ошибка MongoDB:', err));

const guildSchema = new mongoose.Schema({
  guildId: String,
  name: String,
  iconUrl: { type: String, default: '' },
  totalMessages: { type: Number, default: 0 },
  memberCount: { type: Number, default: 0 },
  onlineCount: { type: Number, default: 0 },
  dailyStats: [{
    date: String,
    count: { type: Number, default: 0 }
  }]
});

const Guild = mongoose.model('Guild', guildSchema);

function getTodayDateString() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.MESSAGE_CONTENT,
    Intents.FLAGS.GUILD_VOICE_STATES,
    Intents.FLAGS.GUILD_PRESENCES
  ]
});

client.on('ready', () => console.log(`✅ Бот запущен: ${client.user.tag}`));

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const todayStr = getTodayDateString();
  
  // ИСПРАВЛЕНО ДЛЯ ДИСКОРД v13: Получаем правильную ссылку на иконку
  let icon = '';
  if (message.guild.icon) {
    icon = `https://discordapp.com{message.guild.id}/${message.guild.icon}.png?size=128`;
  }

  const onlineCount = message.guild.presences.cache.filter(
    p => p.status && p.status !== 'offline'
  ).size;

  try {
    const guildData = await Guild.findOne({ guildId: message.guild.id });
    
    if (guildData) {
      guildData.name = message.guild.name;
      guildData.iconUrl = icon; // Перезаписываем правильную ссылку
      guildData.memberCount = message.guild.memberCount;
      guildData.onlineCount = onlineCount || 1;
      guildData.totalMessages += 1;

      const dayRecord = guildData.dailyStats.find(d => d.date === todayStr);
      if (dayRecord) {
        dayRecord.count += 1;
      } else {
        guildData.dailyStats.push({ date: todayStr, count: 1 });
      }

      if (guildData.dailyStats.length > 45) guildData.dailyStats.shift();
      await guildData.save();
    } else {
      await Guild.create({
        guildId: message.guild.id,
        name: message.guild.name,
        iconUrl: icon,
        totalMessages: 1,
        memberCount: message.guild.memberCount,
        onlineCount: onlineCount || 1,
        dailyStats: [{ date: todayStr, count: 1 }]
      });
    }
  } catch (err) {
    console.error('❌ Ошибка обновления БД:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);

function processPeriods(guilds) {
  const todayStr = getTodayDateString();
  const now = new Date();

  return guilds.map(g => {
    let dayCount = 0;
    let weekCount = 0;
    let monthCount = 0;
    let weekLabels = [];
    let weekData = [];
    let monthLabels = [];
    let monthData = [];

    for(let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const s = d.toISOString().split('T')[0];
      weekLabels.push(s.substring(5));
      const found = g.dailyStats.find(x => x.date === s);
      weekData.push(found ? found.count : 0);
      if(found) weekCount += found.count;
    }

    for(let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const s = d.toISOString().split('T')[0];
      monthLabels.push(s.substring(5));
      const found = g.dailyStats.find(x => x.date === s);
      monthData.push(found ? found.count : 0);
      if(found) monthCount += found.count;
    }

    const todayRecord = g.dailyStats.find(x => x.date === todayStr);
    dayCount = todayRecord ? todayRecord.count : 0;

    return {
      guildId: g.guildId,
      name: g.name,
      iconUrl: g.iconUrl,
      memberCount: g.memberCount,
      onlineCount: g.onlineCount,
      totalMessages: g.totalMessages,
      periods: { day: dayCount, week: weekCount, month: monthCount, all: g.totalMessages },
      charts: {
        week: { labels: weekLabels, data: weekData },
        month: { labels: monthLabels, data: monthData }
      }
    };
  });
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => res.send('<h1>Statbot запущен!</h1><p><a href="/dashboard">Перейти в дашборд</a></p>'));

app.get('/dashboard', async (req, res) => {
  const rawStats = await Guild.find();
  const stats = processPeriods(rawStats);
  res.render('dashboard', { stats });
});

app.get('/api/stats', async (req, res) => {
  const rawStats = await Guild.find();
  const stats = processPeriods(rawStats);
  res.json(stats);
});

app.listen(PORT, () => console.log(`🌐 Веб-панель: http://localhost:${PORT}`));
