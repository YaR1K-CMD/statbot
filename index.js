require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ====================== MONGO ======================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB подключен'))
  .catch(err => console.error('❌ MongoDB:', err));

// ====================== МОДЕЛЬ ======================
const guildSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  name: String,
  totalMessages: { type: Number, default: 0 },
  totalVoiceMinutes: { type: Number, default: 0 },
  memberCount: { type: Number, default: 0 },
  onlineCount: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now }
});

const Guild = mongoose.model('Guild', guildSchema);

// ====================== DISCORD BOT ======================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
  ]
});

client.on('ready', () => {
  console.log(`✅ Бот запущен: ${client.user.tag}`);
  updateStatsPeriodically();
});

async function updateStatsPeriodically() {
  setInterval(async () => {
    client.guilds.cache.forEach(async (guild) => {
      const online = guild.members.cache.filter(m => m.presence?.status === 'online').size;
      await Guild.findOneAndUpdate(
        { guildId: guild.id },
        {
          name: guild.name,
          memberCount: guild.memberCount,
          onlineCount: online,
          lastUpdated: new Date()
        },
        { upsert: true }
      );
    });
  }, 60000); // каждую минуту
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  await Guild.findOneAndUpdate(
    { guildId: message.guild.id },
    { $inc: { totalMessages: 1 } },
    { upsert: true }
  );
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  // Простая логика подсчёта времени в войсе (можно улучшить)
  if (oldState.channelId && !newState.channelId) {
    // вышел из войса
    const minutes = 5; // заглушка
    await Guild.findOneAndUpdate(
      { guildId: oldState.guild.id },
      { $inc: { totalVoiceMinutes: minutes } },
      { upsert: true }
    );
  }
});

// Команда /stats
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;
  if (interaction.commandName === 'stats') {
    const data = await Guild.findOne({ guildId: interaction.guild.id });
    const embed = new EmbedBuilder()
      .setTitle(`Статистика ${interaction.guild.name}`)
      .setColor(0x00ff00)
      .addFields(
        { name: 'Участников', value: `${data?.memberCount || 0}`, inline: true },
        { name: 'Онлайн', value: `${data?.onlineCount || 0}`, inline: true },
        { name: 'Сообщений', value: `${data?.totalMessages || 0}`, inline: true },
        { name: 'Войс минут', value: `${data?.totalVoiceMinutes || 0}`, inline: true }
      );
    await interaction.reply({ embeds: [embed] });
  }
});

client.login(process.env.DISCORD_TOKEN);

// ====================== WEB DASHBOARD ======================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

app.get('/', (req, res) => res.redirect('/dashboard'));

app.get('/dashboard', async (req, res) => {
  const guilds = await Guild.find().sort({ totalMessages: -1 });
  res.render('dashboard', { guilds });
});

app.listen(PORT, () => {
  console.log(`🌐 Веб-панель: http://localhost:${PORT}`);
});
