require('dotenv').config();
const { Client, Intents } = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ MONGODB
// ==========================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB подключен'))
  .catch(err => console.error('❌ Ошибка MongoDB:', err));

const guildSchema = new mongoose.Schema({
  guildId: String,
  name: String,
  iconUrl: { type: String, default: '' }, // Ссылка на иконку сервера
  totalMessages: { type: Number, default: 0 },
  memberCount: { type: Number, default: 0 },
  onlineCount: { type: Number, default: 0 },
  // Массив для хранения истории сообщений по дням
  dailyStats: [{
    date: String, // Формат "YYYY-MM-DD"
    count: { type: Number, default: 0 }
  }]
});

const Guild = mongoose.model('Guild', guildSchema);

// Вспомогательная функция для получения текущей даты в формате YYYY-MM-DD
function getTodayDateString() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

// ==========================================
// 2. НАСТРОЙКА И ЗАПУСК DISCORD БОТА
// ==========================================
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

client.on('ready', () => {
  console.log(`✅ Бот запущен: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const todayStr = getTodayDateString();
  
  // Получаем ссылку на иконку сервера (если она есть)
  const icon = message.guild.iconURL({ format: 'png', dynamic: true, size: 128 }) || '';

  // Считаем пользователей в кеше, чей статус НЕ offline (online, idle, dnd)
  const onlineCount = message.guild.presences.cache.filter(
    p => p.status && p.status !== 'offline'
  ).size;

  try {
    // Сначала проверим, есть ли уже запись для сегодняшнего дня в массиве dailyStats
    const guildData = await Guild.findOne({ guildId: message.guild.id });
    
    if (guildData) {
      guildData.name = message.guild.name;
      guildData.iconUrl = icon;
      guildData.memberCount = message.guild.memberCount;
      guildData.onlineCount = onlineCount || 1;
      guildData.totalMessages += 1;

      // Ищем сегодняшний день в массиве истории
      const dayRecord = guildData.dailyStats.find(d => d.date === todayStr);
      if (dayRecord) {
        dayRecord.count += 1;
      } else {
        guildData.dailyStats.push({ date: todayStr, count: 1 });
      }

      // Ограничиваем историю последних 45 дней, чтобы БД не раздувалась
      if (guildData.dailyStats.length > 45) {
        guildData.dailyStats.shift();
      }

      await guildData.save();
    } else {
      // Если сервера еще нет в БД, создаем с нуля
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
    console.error('❌ Ошибка при обновлении статистики в БД:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);

// ==========================================
// 3. ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ АГРЕГАЦИИ СТАТИСТИКИ
// ==========================================
function processPeriods(guilds) {
  const todayStr = getTodayDateString();
  
  // Вычисляем таймстемпы для фильтрации периодов
  const now = new Date();
  
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return guilds.map(g => {
    let dayCount = 0;
    let weekCount = 0;
    let monthCount = 0;

    // Массивы для хранения детальных точек графиков (таймлайн)
    let weekLabels = [];
    let weekData = [];
    let monthLabels = [];
    let monthData = [];

    // Генерируем пустые шаблоны для последних 7 дней
    for(let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const s = d.toISOString().split('T')[0];
      weekLabels.push(s.substring(5)); // Формат "MM-DD"
      const found = g.dailyStats.find(x => x.date === s);
      weekData.push(found ? found.count : 0);
      if(found) weekCount += found.count;
    }

    // Генерируем шаблоны для последних 30 дней
    for(let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const s = d.toISOString().split('T')[0];
      monthLabels.push(s.substring(5));
      const found = g.dailyStats.find(x => x.date === s);
      monthData.push(found ? found.count : 0);
      if(found) monthCount += found.count;
    }

    // Сегодняшние сообщения напрямую
    const todayRecord = g.dailyStats.find(x => x.date === todayStr);
    dayCount = todayRecord ? todayRecord.count : 0;

    return {
      guildId: g.guildId,
      name: g.name,
      iconUrl: g.iconUrl,
      memberCount: g.memberCount,
      onlineCount: g.onlineCount,
      totalMessages: g.totalMessages,
      periods: {
        day: dayCount,
        week: weekCount,
        month: monthCount,
        all: g.totalMessages
      },
      charts: {
        week: { labels: weekLabels, data: weekData },
        month: { labels: monthLabels, data: monthData }
      }
    };
  });
}

// ==========================================
// 4. НАСТРОЙКА ВЕБ-ИНТЕРФЕЙСА (EXPRESS / EJS)
// ==========================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => {
  res.send('<h1>Statbot запущен!</h1><p><a href="/dashboard">Перейти в дашборд</a></p>');
});

app.get('/dashboard', async (req, res) => {
  try {
    const rawStats = await Guild.find();
    const stats = processPeriods(rawStats);
    res.render('dashboard', { stats });
  } catch (err) {
    res.status(500).send('Ошибка при получении данных дашборда');
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const rawStats = await Guild.find();
    const stats = processPeriods(rawStats);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

app.listen(PORT, () => {
  console.log(`🌐 Веб-панель: http://localhost:${PORT}`);
});
