require('dotenv').config();
const { Client, Intents } = require('discord.js'); // В v13 EmbedBuilder нет, удалили его, чтобы не было ошибок
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB подключен'))
  .catch(err => console.error('❌ MongoDB:', err));

const guildSchema = new mongoose.Schema({
  guildId: String,
  name: String,
  totalMessages: { type: Number, default: 0 },
  memberCount: { type: Number, default: 0 },
  onlineCount: { type: Number, default: 0 }
});

const Guild = mongoose.model('Guild', guildSchema);

// Интенты для v13 — оставляем ваши рабочие флаги
const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.MESSAGE_CONTENT, // Потребуется, если проверяете текст, но для счетчика сообщений достаточно базового флага
    Intents.FLAGS.GUILD_VOICE_STATES,
    Intents.FLAGS.GUILD_PRESENCES
  ]
});

client.on('ready', () => console.log(`✅ Бот запущен: ${client.user.tag}`));

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // Безопасный подсчет онлайна для discord.js v13
  // Считаем всех, чей статус в кеше равен 'online', 'idle' или 'dnd'
  const onlineCount = message.guild.presences.cache.filter(
    p => p.status && p.status !== 'offline'
  ).size;

  await Guild.findOneAndUpdate(
    { guildId: message.guild.id },
    { 
      $inc: { totalMessages: 1 }, 
      name: message.guild.name, 
      memberCount: message.guild.memberCount,
      onlineCount: onlineCount || 1 // Если кеш пустой, запишем хотя бы 1 (автора сообщения)
    },
    { upsert: true }
  );
});

client.login(process.env.DISCORD_TOKEN);

// Web-интерфейс
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/', (req, res) => {
  res.send('<h1>Statbot запущен!</h1><p><a href="/dashboard">Перейти в дашборд</a></p>');
});

app.get('/dashboard', async (req, res) => {
  const stats = await Guild.find().sort({ totalMessages: -1 });
  res.render('dashboard', { stats });
});

app.listen(PORT, () => {
  console.log(`🌐 Веб-панель: http://localhost:${PORT}`);
});
