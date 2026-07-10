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
  totalMessages: { type: Number, default: 0 },
  memberCount: { type: Number, default: 0 },
  onlineCount: { type: Number, default: 0 }
});

const Guild = mongoose.model('Guild', guildSchema);

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

  // Считаем пользователей в кеше, чей статус НЕ offline (online, idle, dnd)
  const onlineCount = message.guild.presences.cache.filter(
    p => p.status && p.status !== 'offline'
  ).size;

  try {
    await Guild.findOneAndUpdate(
      { guildId: message.guild.id },
      { 
        $inc: { totalMessages: 1 }, 
        name: message.guild.name, 
        memberCount: message.guild.memberCount,
        onlineCount: onlineCount || 1 // Если кеш пустой, запишем минимум 1 (автора сообщения)
      },
      { upsert: true }
    );
  } catch (err) {
    console.error('❌ Ошибка при обновлении статистики в БД:', err);
  }
});

client.login(process.env.DISCORD_TOKEN);

// ==========================================
// 3. НАСТРОЙКА ВЕБ-ИНТЕРФЕЙСА (EXPRESS / EJS)
// ==========================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Главная страница
app.get('/', (req, res) => {
  res.send('<h1>Statbot запущен!</h1><p><a href="/dashboard">Перейти в дашборд</a></p>');
});

// Страница Дашборда (первичный рендеринг)
app.get('/dashboard', async (req, res) => {
  try {
    const stats = await Guild.find().sort({ totalMessages: -1 });
    res.render('dashboard', { stats });
  } catch (err) {
    res.status(500).send('Ошибка при получении данных дашборда');
  }
});

// API-эндпоинт для автообновления (отдает данные в формате JSON)
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await Guild.find().sort({ totalMessages: -1 });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

// Запуск веб-сервера
app.listen(PORT, () => {
  console.log(`🌐 Веб-панель: http://localhost:${PORT}`);
});
