const { 
  Client, 
  EmbedBuilder, 
  GatewayIntentBits, 
  PermissionsBitField, 
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Events, Partials, 
  ActivityType
} = require('discord.js');
const { Routes } = require('discord-api-types/v9');
const { REST } = require('@discordjs/rest');
const mysql = require('mysql2/promise');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember, Partials.Reaction],

});

// ============== MySQL ==============
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql.db.bot-hosting.net',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'u253813_N4grLRn8Xv',
  password: process.env.DB_PASSWORD || 'G@LLxndU^3F!.UBby@zhRQLK',
  database: process.env.DB_NAME || 's253813_log',
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 30,
  connectTimeout: 10000,
  charset: 'utf8mb4_unicode_ci'
});

// ============== Global Config ==============
const CONFIG = {
  deleteDelay: 1500,
  maxFetch: 100,
  commandPrefix: '!',
  db: {
    retries: 3,
    backoffBase: 500
  }
};

// ============== Database ==============
const db = {
  withRetry: async (fn, context = 'DB operation') => {
    for (let attempt = 1; attempt <= CONFIG.db.retries; attempt++) {
      const conn = await pool.getConnection().catch(err => {
        console.error(`${context} - fail to contect the database (has tried for ${attempt}) times`, err);
        return null;
      });
      
      if (!conn) continue;

      try {
        const result = await fn(conn);
        conn.release();
        return result;
      } catch (err) {
        conn.release();
        console.error(`${context} - fail to contect the database (has tried for ${attempt}) times`, err);
        if (attempt < CONFIG.db.retries) {
          await new Promise(r => setTimeout(r, CONFIG.db.backoffBase * Math.pow(2, attempt)));
        }
      }
    }
    throw new Error(`fail to contect the database and has tried for ${CONFIG.db.retries} 次`);
  },

  init: async () => {
    await db.withRetry(async (conn) => {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS guild_settings (
          guild_id VARCHAR(20) PRIMARY KEY,
          log_channel VARCHAR(20),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      await conn.query(`
        CREATE TABLE IF NOT EXISTS purge_audit (
          audit_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          guild_id VARCHAR(20) NOT NULL,
          executor_id VARCHAR(20) NOT NULL,
          target_id VARCHAR(20) NOT NULL,
          deleted_count INT UNSIGNED NOT NULL,
          channels JSON NOT NULL,
          execution_time FLOAT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_guild (guild_id),
          INDEX idx_executor (executor_id),
          INDEX idx_target (target_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
    }, 'database initialization');
  },

  setLogChannel: async (guildId, channelId) => {
    return db.withRetry(async (conn) => {
      await conn.query(`
        INSERT INTO guild_settings (guild_id, log_channel)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE 
          log_channel = VALUES(log_channel),
          updated_at = CURRENT_TIMESTAMP
      `, [guildId, channelId]);
    }, 'Set log channel');
  },

  getLogChannel: async (guildId) => {
    return db.withRetry(async (conn) => {
      const [rows] = await conn.query(
        'SELECT log_channel FROM guild_settings WHERE guild_id = ?',
        [guildId]
      );
      return rows[0]?.log_channel || null;
    }, 'Get log channel');
  },

  resetLogChannel: async (guildId) => {
    return db.withRetry(async (conn) => {
      await conn.query(
        'DELETE FROM guild_settings WHERE guild_id = ?',
        [guildId]
      );
    }, 'Reset log channel');
  },

  logPurge: async (guildId, executorId, targetId, count, channels, duration) => {
    return db.withRetry(async (conn) => {
      await conn.query(`
        INSERT INTO purge_audit 
          (guild_id, executor_id, target_id, deleted_count, channels, execution_time)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [guildId, executorId, targetId, count, JSON.stringify(channels), duration]);
    }, 'Log purge');
  }
};

// ============== Slashcmd ==============
const commands = [
  new SlashCommandBuilder()
  .setName('purge')
  .setDescription('Delete a user all messages')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('target user')
      .setRequired(true))
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

new SlashCommandBuilder()
  .setName('logchannel')
  .setDescription('set a log channel for message purge')
  .addSubcommand(subcommand =>
    subcommand.setName('set')
      .setDescription('set a log channel')
      .addChannelOption(option =>
        option.setName('channel')
          .setDescription('must be a text channel')
          .setRequired(true)))
  .addSubcommand(subcommand =>
    subcommand.setName('get')
      .setDescription('get current log channel that already set'))
  .addSubcommand(subcommand =>
    subcommand.setName('reset')
      .setDescription('reset log channel'))
  .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show command list and info'),

new SlashCommandBuilder()
  .setName('audit')
   .setDescription('check purge audit logs')
   .addSubcommand(subcommand =>
      subcommand.setName('user')
      .setDescription('user specific logs')
       .addUserOption(option =>
          option.setName('target')
          .setDescription('target user')
          .setRequired(true))
      .addIntegerOption(option =>
          option.setName('limit')
          .setDescription('show number (max 10)')))
   .addSubcommand(subcommand =>
      subcommand.setName('guild')
      .setDescription('all guild logs of the server')
      .addIntegerOption(option =>
          option.setName('limit')
          .setDescription('show number (max 20)')))
   .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
   .toJSON(),

];

// ============== Core of purge ==============
async function executePurge(targetUserId, executorId, guild) {
  const startTime = Date.now();
  const report = {
    total: 0,
    channels: [],
    samples: [],
    errors: []
  };

  const channels = guild.channels.cache.filter(c => 
    c.isTextBased() &&
    c.permissionsFor(guild.members.me).has([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.ManageMessages
    ])
  );

  for (const [channelId, channel] of channels) {
    try {
      const messages = await channel.messages.fetch({ 
        limit: CONFIG.maxFetch,
        cache: false 
      });
      const targets = messages.filter(m => m.author.id === targetUserId);

      // Purge Msg older than 14 days
      const deletable = targets.filter(m => 
        Date.now() - m.createdTimestamp <= 1209600000 // 14days 
      );
      const manualDeletable = targets.filter(m => 
        Date.now() - m.createdTimestamp > 1209600000
      );

      if (deletable.size > 0) {
        const deleted = await channel.bulkDelete(deletable);
        report.total += deleted.size;
        report.channels.push({
          id: channelId,
          name: channel.name,
          count: deleted.size
        });
        report.samples.push(...Array.from(deleted.values()).slice(0, 3).map(m => ({
          id: m.id,
          content: m.cleanContent.substring(0, 100),
          created: m.createdAt.toISOString()
        })));
      }

      for (const [messageId, message] of manualDeletable) {
        try {
          await message.delete();
          report.total++;
          await new Promise(r => setTimeout(r, CONFIG.deleteDelay));
        } catch (err) {
          report.errors.push({
            channel: channelId,
            message: messageId,
            error: err.message
          });
        }
      }
    } catch (err) {
      report.errors.push({
        channel: channelId,
        message: 'CHANNEL_PROCESS_FAILURE',
        error: err.message
      });
    }
  }

  // record the purge action
  const duration = (Date.now() - startTime) / 1000;
  await db.logPurge(
    guild.id,
    executorId,
    targetUserId,
    report.total,
    report.channels,
    duration
  );

  const embed = new EmbedBuilder()
  .setColor(0x0099FF)
  .setTitle('Report')
  .addFields(
    { name: 'Target user', value: `<@${targetUserId}>`, inline: true },
    { name: 'Deleted', value: `${report.total} messages`, inline: true },
    { name: 'Affected Channel', value: report.channels.map(c => `#${c.name} (${c.count})`).join('\n') || 'Null', inline: false }
  )
  .setFooter({ text: `excute time: ${duration.toFixed(2)}s` })
  

  return embed;
}

// ============== handler ==============
client.on('messageCreate', async message => {
  // Prefix command
  if (message.author.bot) return;

  // Purge 
  if (message.content.startsWith(`${CONFIG.commandPrefix}purge`)) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply({ content: '❌ Require Administrator permission', ephemeral: true });
    }

    const args = message.content.split(/ +/);
    const targetUser = message.mentions.users.first() || args[1];
    if (!targetUser) {
      return message.reply({ content: '❌ Invalid user', ephemeral: true });
    }

    const processing = await message.reply('🔄 In processing...');
    try {
      const report = await executePurge(targetUser.id, message.author.id, message.guild);
      await processing.edit({ content: '✅ Done', embeds: [report] });
      await logAction(message.guild.id, report);
    } catch (err) {
      await processing.edit(`⚠️ Fail: ${err.message}`);
      console.error('Error:', err);
    }
  }

  // Logchannel 
  if (message.content.startsWith(`${CONFIG.commandPrefix}logchannel`)) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply({ content: '❌ Require Administrator permission', ephemeral: true });
    }

    const args = message.content.split(/ +/);
    const subCommand = args[1];
    const channel = message.mentions.channels.first() || args[2];
    await handleLogChannel(message, subCommand, channel);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  // Purge 
  if (interaction.commandName === 'purge') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Require Administrator permission', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    await interaction.deferReply();

    try {
      const report = await executePurge(targetUser.id, interaction.user.id, interaction.guild);
      await interaction.editReply({ embeds: [report] });
      await logAction(interaction.guild.id, report);
    } catch (err) {
      await interaction.editReply(`⚠️ Fail: ${err.message}`);
      console.error('Error:', err);
    }
  }

  // Logchannel 
  if (interaction.commandName === 'logchannel') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Require Admin permission', ephemeral: true });
    }

    const subCommand = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('channel');
    await handleLogChannel(interaction, subCommand, channel);
  }

  // Audit 
  if (interaction.commandName === 'audit') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ Require Admin permission', ephemeral: true });
    }

    const subCommand = interaction.options.getSubcommand();
    const limit = interaction.options.getInteger('limit') || (subCommand === 'user' ? 10 : 20);
    
    try {
      const embed = await generateAuditReport(subCommand, interaction, limit);
      await interaction.reply({ embeds: [embed]});
    } catch (err) {
      await interaction.reply({ content: `❌ Fail to check: ${err.message}`, ephemeral: true });
    }
  }

  // Help 
  if (interaction.commandName === 'help') {
    const embed = new EmbedBuilder()
    .setTitle("List of Commands")
    .addFields(
      {
        name: "**1. Purge **",
        value: "```\n/purge <user>\n```or\n```\n!purge <user id>\n```\n⚠️User who use this command **must have Administrator permission**\n⚠️Recommend setting a log channel before purging someone\n\n========================",
        inline: false
      },
      {
        name: "**2. Logchannel **",
        value: "```\n/logchannel set <channel> |or| !logchannel set <channel id>\n```\n🔼Set a log channel for saving purge records\n\n```\n/logchannel reset |or| !logchannel reset\n```\n🔼Reset a log channel that has been set before\n\n```\n/logchannel get |or| !logchannel get\n```\n🔼Get the log channel that has been set\n⚠️Only user with admin permission will be able to use logchannel cmd",
        inline: false
      },
    )
    .setColor("#00b0f4")
    .setTimestamp();

    await interaction.reply({ embeds: [embed]});
  }
});
// ============== Reply ==============
async function respond(context, message, isSlash) {
  try {
    if (isSlash) {
      // slashcmd
      if (context.replied || context.deferred) {
        await context.editReply(message);
      } else {
        await context.reply(message);
      }
    } else {
      // prefix
      const msg = await context.channel.send(message);
    }
  } catch (err) {
    console.error('Fail to respond', err.message);
    if (isSlash) {
      await context.followUp({ 
        content: '⚠️ Fail to respond, please make sure I have permission to send messages in this channel', 
        ephemeral: true 
      });
    }
  }
}

// ============== Logchannel main core ==============
async function handleLogChannel(context, subCommand, channel) {
  const isSlash = context instanceof ChatInputCommandInteraction;
  const guildId = context.guild.id;

  try {
    switch (subCommand) {
      case 'set':
        if (!channel?.isTextBased()) throw new Error('Invalid channel type');
        await db.setLogChannel(guildId, channel.id);
        await respond(context, `✅ Log channel has set to be <#${channel.id}>`, isSlash);
        break;

      case 'get':
        const savedId = await db.getLogChannel(guildId);
        await respond(context, 
          savedId ? `📝 Currently log channel: <#${savedId}>` : 'No log channel has been set', 
          isSlash
        );
        break;

      case 'reset':
        await db.resetLogChannel(guildId);
        await respond(context, '🔄 Reset the log channel succesfully', isSlash);
        break;
    }
  } catch (err) {
    await respond(context, `⚠️ Fail: ${err.message}`, isSlash);
    console.error('Error', err);
  }
}

async function generateAuditReport(type, interaction, limit) {
  const conn = await pool.getConnection();
  try {
    let query, params;
    const guildId = interaction.guild.id;

    if (type === 'user') {
      const target = interaction.options.getUser('target');
      query = `
        SELECT * FROM purge_audit 
        WHERE guild_id = ? AND target_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `;
      params = [guildId, target.id, limit];
    } else {
      query = `
        SELECT * FROM purge_audit 
        WHERE guild_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `;
      params = [guildId, limit];
    }

    const [logs] = await conn.query(query, params);
    if (logs.length === 0) {
      return new EmbedBuilder()
        .setColor(0x888888)
        .setTitle('No recond found')
        .setDescription('Did not find any record for this user or server');
    }

    const embed = new EmbedBuilder()
      .setColor(0x00FF99)
      .setTitle(`Report - ${type === 'user' ? 'User record' : 'Server record'}`)
      .setFooter({ text: `Show the current ${logs.length} records` });

    const fields = logs.map(log => ({
      name: `[${log.audit_id}] ${new Date(log.created_at).toLocaleDateString()}`,
      value: [
        `Operator: <@${log.executor_id}>`,
        `Target user: <@${log.target_id}>`,
        `Number of deletions: ${log.deleted_count}`,
        `Time spent: ${log.execution_time.toFixed(2)}s`,
        `Channel: ${JSON.parse(log.channels).map(c => `#${c.name}`).join(', ')}`
      ].join('\n'),
      inline: true
    }));

    embed.addFields(...fields);
    return embed;
  } finally {
    conn.release();
  }
}

async function logAction(guildId, embed) {
  try {
    const channelId = await db.getLogChannel(guildId);
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId);
    if (channel?.isTextBased()) {
      await channel.send({ 
        embeds: [embed],
        content: '🔔 New purge record'
      });
    }
  } catch (err) {
    console.error('Fail to send log:', err);
  }
}

// ============== Login ==============
client.once(Events.ClientReady, async readyClient => {
  console.log(`✅ Log in as: ${readyClient.user.tag}`);
  
  try {
    await db.init();
    console.log('📦 Database connected');

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('🔗 Slashcmd registered');

    client.user.setPresence({
      activities: [{
        name: '/help for more info',
        type: ActivityType.Playing
      }],
      status: 'online'
    });
  } catch (err) {
    console.error('Fail to login:', err);
    process.exit(1);
  }
});

client.login(process.env.TOKEN);
