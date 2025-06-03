// discord_reprimand_bot/index.js
// A Discord.js v14 bot to manage reprimand, remediation, and appeal workflows with buttons and modals

import {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder
} from 'discord.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module __dirname workaround
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Environment variables
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const ISSUE_CHANNEL_ID = process.env.ISSUE_CHANNEL_ID;
const PENDING_CHANNEL_ID = ISSUE_CHANNEL_ID;
const APPROVED_CHANNEL_ID = process.env.APPROVED_CHANNEL_ID;
const REMEDIATION_CHANNEL_ID = process.env.REMEDIATION_CHANNEL_ID;
const APPEAL_CHANNEL_ID = process.env.APPEAL_CHANNEL_ID;
const MOD_ROLE_ID = process.env.MOD_ROLE_ID;
const HAD_ROLE_ID = process.env.HAD_ROLE_ID;

// JSON file for persistent data
const COUNTS_FILE = path.resolve(__dirname, 'reprimand_counts.json');

// In-memory stores
const pendingRemediations = new Map();       // approvedMsgId -> { userId, approvedChannelId }
const remediationForms = new Map();          // remediationMsgId -> userId
const appealForms = new Map();               // appealMsgId -> userId
const userReprimandCounts = new Map();       // userId -> count of reprimands

// Load persisted counts
if (fs.existsSync(COUNTS_FILE)) {
  try {
    const raw = fs.readFileSync(COUNTS_FILE, 'utf-8');
    if (raw.trim()) {
      const data = JSON.parse(raw);
      for (const [userId, count] of Object.entries(data)) {
        userReprimandCounts.set(userId, count);
      }
    }
  } catch (err) {
    console.error('Failed to load reprimand counts:', err);
  }
}

// Save helper
function saveCounts() {
  try {
    fs.writeFileSync(COUNTS_FILE, JSON.stringify(Object.fromEntries(userReprimandCounts)), 'utf-8');
  } catch (err) {
    console.error('Failed to save reprimand counts:', err);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const issueChan = await client.channels.fetch(ISSUE_CHANNEL_ID);
  await postIssueButton(issueChan);
  if (REMEDIATION_CHANNEL_ID) {
    const remChan = await client.channels.fetch(REMEDIATION_CHANNEL_ID);
    await postRemediationSystem(remChan);
  }
  if (APPEAL_CHANNEL_ID) {
    const appealChan = await client.channels.fetch(APPEAL_CHANNEL_ID);
    await postAppealSystem(appealChan);
  }
});

// Post "Issue Reprimand" button
async function postIssueButton(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    const old = messages.find(m => m.components?.[0]?.components?.[0]?.customId === 'issue_reprimand');
    if (old) await old.delete();
  } catch {}

  const embed = new EmbedBuilder()
    .setTitle(':pencil: Issue Reprimand')
    .setDescription('Click below to issue a new reprimand.')
    .setColor('Blue');
  const button = new ButtonBuilder()
    .setCustomId('issue_reprimand')
    .setLabel('Issue Reprimand')
    .setStyle(ButtonStyle.Primary);
  await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
}

// Post "Remediation system" button
async function postRemediationSystem(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    const old = messages.find(m => m.components?.[0]?.components?.[0]?.customId === 'remediate');
    if (old) await old.delete();
  } catch {}

  const embed = new EmbedBuilder()
    .setTitle('Remediation system')
    .setDescription('Click below to submit a remediation form.')
    .setColor('Green');
  const button = new ButtonBuilder()
    .setCustomId('remediate')
    .setLabel('Remediate')
    .setStyle(ButtonStyle.Success);
  await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
}

// Post "Reprimand Appeal" button
async function postAppealSystem(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: 50 });
    const old = messages.find(m => m.components?.[0]?.components?.[0]?.customId === 'appeal');
    if (old) await old.delete();
  } catch {}

  const embed = new EmbedBuilder()
    .setTitle('Reprimand Appeal System')
    .setDescription('Click below to submit an appeal form regarding a reprimand.')
    .setColor('Purple');
  const button = new ButtonBuilder()
    .setCustomId('appeal')
    .setLabel('Submit Appeal')
    .setStyle(ButtonStyle.Primary);
  await channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] });
}

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    // Issue, Remediate, and Appeal buttons
    if (interaction.customId === 'issue_reprimand') {
      const modal = new ModalBuilder()
        .setCustomId('reprimand_modal')
        .setTitle('New Reprimand')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('issue_to').setLabel('Issue to (User ID)').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('charter_article').setLabel('Charter article').setStyle(TextInputStyle.Paragraph).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('remediation').setLabel('Remediation method').setStyle(TextInputStyle.Paragraph).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('proof').setLabel('Proof (evidence)').setStyle(TextInputStyle.Paragraph)
          )
        );
      return interaction.showModal(modal);
    } else if (interaction.customId === 'remediate') {
      // Allow remediation if user has a pending remediation request
      const hasActive = Array.from(pendingRemediations.values()).some(v => v.userId === interaction.user.id);
      if (!hasActive) return;
      const modal = new ModalBuilder()
        .setCustomId('remediation_modal')
        .setTitle('Submit Remediation')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('reprimand_link').setLabel('Link to Reprimand').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('remediation_proof').setLabel('Remediation proof').setStyle(TextInputStyle.Paragraph).setRequired(true)
          )
        );
      return interaction.showModal(modal);
    } else if (interaction.customId === 'appeal') {
      // Allow appeal if user does NOT have a pending appeal request
      const hasActive = Array.from(appealForms.values()).some(d => d === interaction.user.id);
      if (hasActive) return;
      const modal = new ModalBuilder()
        .setCustomId('appeal_modal')
        .setTitle('Submit Reprimand Appeal')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('appeal_link').setLabel('Link to Reprimand').setStyle(TextInputStyle.Short).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('appeal_reason').setLabel('Reason for appeal').setStyle(TextInputStyle.Paragraph).setRequired(true)
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('appeal_proof').setLabel('Proof').setStyle(TextInputStyle.Paragraph).setRequired(true)
          )
        );
      return interaction.showModal(modal);(modal);
    }

    // Moderation button handlers for Reprimand, Remediation, and Appeal
    if (!interaction.member.roles.cache.has(MOD_ROLE_ID)) {
      return interaction.reply({ content: "You don't have permission.", ephemeral: true });
    }
    const id = interaction.customId;
    const msg = interaction.message;

    // Approve Reprimand
    if (id === 'approve_reprimand') {
      await interaction.deferUpdate({ ephemeral: true});
      const embedReq = EmbedBuilder.from(msg.embeds[0]);
      const toField = embedReq.data.fields.find(f => f.name === 'Issued to');
      const userId = toField.value.match(/\d+/)[0];
      const prevCount = userReprimandCounts.get(userId) || 0;
      const newCount = Math.min(prevCount + 1, 3);
      userReprimandCounts.set(userId, newCount);
      saveCounts();

      const fieldsReq = embedReq.data.fields.map(f => f.name === 'Status' ? { name: 'Status', value: 'Approved' } : f);
      fieldsReq.push({ name: ':man_judge: Approved by', value: `<@${interaction.user.id}>` });
      embedReq.setFields(fieldsReq).setColor(newCount === 3 ? 'Red' : 'Green').setTimestamp();
      await msg.edit({ embeds: [embedReq], components: [] });

      const approvedEmbed = new EmbedBuilder()
        .setTitle(':pencil: Reprimand')
        .addFields(...fieldsReq)
        .setColor(newCount === 3 ? 'Red' : 'Green')
        .setTimestamp();
      const approvedChan = await client.channels.fetch(APPROVED_CHANNEL_ID);
      const sent = await approvedChan.send({ content: toField.value, embeds: [approvedEmbed] });

      if (newCount < 3) {
        pendingRemediations.set(sent.id, { userId, approvedChannelId: approvedChan.id });
      }
      return;
    }

    // Reject Reprimand
    if (id === 'reject_reprimand') {
      const modal = new ModalBuilder()
        .setCustomId(`reject_reprimand_modal:${msg.id}`)
        .setTitle('Rejection Reason')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rejection_reason').setLabel('Reason for rejection').setStyle(TextInputStyle.Paragraph).setRequired(true)
          )
        );
      return interaction.showModal(modal);
    }

    // Approve Remediation (reset count)
    if (id === 'approve_remediation') {
      await interaction.deferUpdate({ ephemeral: true });
      const formUserId = remediationForms.get(msg.id);
      remediationForms.delete(msg.id);

      // Update the embed to Approved
      const embedRem = EmbedBuilder.from(msg.embeds[0])
        .setColor('Green')
        .setTimestamp();
      const fieldsRem = embedRem.data.fields.map(f =>
        f.name === 'Status'
          ? { name: 'Status', value: 'Approved' }
          : f
      );
      fieldsRem.push({ name: ':man_judge: Approved by', value: `<@${interaction.user.id}>` });
      embedRem.setFields(fieldsRem);
      await msg.edit({ embeds: [embedRem], components: [] });

      // Reset counts
      userReprimandCounts.set(formUserId, 0);
      saveCounts();

      // Notify the user via DM
      try {
        await client.users.send(formUserId, {
          embeds: [
            new EmbedBuilder()
              .setTitle('Your Remediation form was approved')
              .addFields({
                name: ':link: Remediation form',
                value: `[Go to remediation form](https://discord.com/channels/${GUILD_ID}/${REMEDIATION_CHANNEL_ID}/${msg.id})`
              })
              .setColor('Green')
              .setTimestamp()
          ]
        });
      } catch {} 

      return;
    }

    // Reject Remediation button
    if (id === 'reject_remediation') {
      const modal = new ModalBuilder()
        .setCustomId(`reject_remediation_modal:${msg.id}`)
        .setTitle('Rejection reason')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rejection_reason').setLabel('Reason for rejection').setStyle(TextInputStyle.Paragraph).setRequired(true)
          )
        );
      return interaction.showModal(modal);
    }

    // Approve Appeal (decrement count)
    if (id === 'approve_appeal') {
      await interaction.deferUpdate({ ephemeral: true });
      const formUserId = appealForms.get(msg.id);
      appealForms.delete(msg.id);

      // Update the embed to Approved
      const embedApp = EmbedBuilder.from(msg.embeds[0])
        .setColor('Green')
        .setTimestamp();
      const fieldsApp = embedApp.data.fields.map(f =>
        f.name === 'Status'
          ? { name: 'Status', value: 'Approved' }
          : f
      );
      fieldsApp.push({ name: ':man_judge: Approved by', value: `<@${interaction.user.id}>` });
      embedApp.setFields(fieldsApp);
      await msg.edit({ embeds: [embedApp], components: [] });

      // Decrement user's reprimand count by 1 (not below 0)
      const prevCount = userReprimandCounts.get(formUserId) || 0;
      const newCount = Math.max(prevCount - 1, 0);
      userReprimandCounts.set(formUserId, newCount);
      saveCounts();

      // Notify the user via DM
      try {
        await client.users.send(formUserId, {
          embeds: [
            new EmbedBuilder()
              .setTitle('Your Reprimand appeal was approved')
              .addFields({
                name: ':link: Appeal form',
                value: `[Go to appeal form](https://discord.com/channels/${GUILD_ID}/${APPEAL_CHANNEL_ID}/${msg.id})`
              })
              .setColor('Green')
              .setTimestamp()
          ]
        });
      } catch {}
      return;
    }

    // Reject Appeal button
    if (id === 'reject_appeal') {
      const modal = new ModalBuilder()
        .setCustomId(`reject_appeal_modal:${msg.id}`)
        .setTitle('Rejection reason')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('rejection_reason').setLabel('Reason for rejection').setStyle(TextInputStyle.Paragraph).setRequired(true)
          )
        );
      return interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit()) {
    const id = interaction.customId;
    // New Reprimand modal
    if (id === 'reprimand_modal') {
      await interaction.deferReply({ ephemeral: true});
      const toId = interaction.fields.getTextInputValue('issue_to');
      const charterArticle = interaction.fields.getTextInputValue('charter_article');
      const remediation = interaction.fields.getTextInputValue('remediation');
      const proof = interaction.fields.getTextInputValue('proof') || 'N/A';
      const member = await interaction.guild.members.fetch(toId).catch(() => null);
      const nick = member?.nickname || member?.user.username || 'Unknown';
      const prevCount = userReprimandCounts.get(toId) || 0;
      const nextCount = Math.min(prevCount + 1, 3);
      const embed = new EmbedBuilder()
        .setTitle(':pencil: Reprimand request')
        .addFields(
          { name: 'Status', value: 'Pending approval' },
          { name: 'Issued to', value: `<@${toId}>` },
          { name: ':bust_in_silhouette: Issued by', value: `\`\`\`${interaction.member.nickname||interaction.user.username}\`\`\`` },
          { name: ':dart: Issued to (nickname)', value: `\`\`\`${nick}\`\`\`` },
          { name: ':clipboard: Charter article', value: `\`\`\`${charterArticle}\`\`\`` },
          { name: ':scales: Remediation method', value: `\`\`\`${remediation}\`\`\`` },
          { name: ':mag: Evidence', value: proof },
          { name: ':bar_chart: Reprimand status', value: `\`\`\`${nextCount}/3\`\`\`` }
        )
        .setColor('Yellow')
        .setTimestamp();
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('approve_reprimand').setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('reject_reprimand').setLabel('Reject').setStyle(ButtonStyle.Danger)
        );
      const chan = await client.channels.fetch(PENDING_CHANNEL_ID);
      await chan.send({ embeds: [embed], components: [row] });
      await postIssueButton(chan);
      return;
    }
    // Reject Reprimand modal
    if (id.startsWith('reject_reprimand_modal:')) {
      await interaction.deferReply({ ephemeral: true});
      const reason = interaction.fields.getTextInputValue('rejection_reason');
      const msgId = id.split(':')[1];
      const pendingChan = await client.channels.fetch(PENDING_CHANNEL_ID);
      const remMsg = await pendingChan.messages.fetch(msgId).catch(() => null);
      if (!remMsg) return;
      const embedReq = EmbedBuilder.from(remMsg.embeds[0]).setColor('Red').setTimestamp();
      const fieldsReq = embedReq.data.fields.map(f => f.name === 'Status' ? { name: 'Status', value: 'Rejected' } : f);
      fieldsReq.push(
        { name: ':exclamation: Reason', value: `\`\`\`${reason}\`\`\`` },
        { name: ':man_judge: Rejected by', value: `<@${interaction.user.id}>` }
      );
      embedReq.setFields(fieldsReq);
      await remMsg.edit({ embeds: [embedReq], components: [] });
      return;
    }
    // Remediation modal
    if (id === 'remediation_modal') {
      await interaction.deferReply({ ephemeral: true});
      const link = interaction.fields.getTextInputValue('reprimand_link');
      const proof = interaction.fields.getTextInputValue('remediation_proof');
      const hadMention = `<@&${HAD_ROLE_ID}>`;
      const embed = new EmbedBuilder()
        .setTitle(':pencil: Remediation form')
        .addFields(
          { name: 'Status', value: 'Pending approval' },
          { name: 'Sent in by', value: `<@${interaction.user.id}>` },
          { name: ':link: Reprimand link', value: `[Go to reprimand](${link})` },
          { name: ':mag: Remediation proof', value: proof }
        )
        .setColor('Yellow')
        .setTimestamp();
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('approve_remediation').setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('reject_remediation').setLabel('Reject').setStyle(ButtonStyle.Danger)
        );
      const chan = await client.channels.fetch(REMEDIATION_CHANNEL_ID);
      const sent = await chan.send({ content: hadMention, embeds: [embed], components: [row] });
      remediationForms.set(sent.id, interaction.user.id);
      await postRemediationSystem(chan);
      return;
    }
    // Reject Remediation modal
    if (id.startsWith('reject_remediation_modal:')) {
      await interaction.deferReply({ ephemeral: true});
      const reason = interaction.fields.getTextInputValue('rejection_reason');
      const msgId = id.split(':')[1];
      const remChan = await client.channels.fetch(REMEDIATION_CHANNEL_ID);
      const remMsg = await remChan.messages.fetch(msgId).catch(() => null);
      if (!remMsg) return;
      const formUserId = remediationForms.get(remMsg.id);
      const embedRem = EmbedBuilder.from(remMsg.embeds[0]).setColor('Red').setTimestamp();
      const fieldsRem = embedRem.data.fields.map(f => f.name === 'Status' ? { name: 'Status', value: 'Rejected' } : f);
      fieldsRem.push(
        { name: 'Rejection reason', value: `\`\`\`${reason}\`\`\`` },
        { name: ':man_judge: Rejected by', value: `<@${interaction.user.id}>` }
      );
      embedRem.setFields(fieldsRem);
      remediationForms.delete(remMsg.id);
      await remMsg.edit({ embeds: [embedRem], components: [] });
      // DM user their rejection
      try {
        const user = await client.users.fetch(formUserId);
        const dmEmbed = new EmbedBuilder()
          .setTitle('Your Remediation form was rejected')
          .addFields(
            { name: ':exclamation: Reason', value: '```' + reason + '```' },
            { name: ':link: Remediation form', value: `[Go to remediation form](https://discord.com/channels/${GUILD_ID}/${REMEDIATION_CHANNEL_ID}/${remMsg.id})` }
          )
          .setColor('Red')
          .setTimestamp();
        await user.send({ embeds: [dmEmbed] });
      } catch {}
      return;
    }
    // New Appeal modal
    if (id === 'appeal_modal') {
      await interaction.deferReply({ ephemeral: true});
      const link = interaction.fields.getTextInputValue('appeal_link');
      const reason = interaction.fields.getTextInputValue('appeal_reason');
      const proof = interaction.fields.getTextInputValue('appeal_proof');
      const hadMention = `<@&${HAD_ROLE_ID}>`;
      const embed = new EmbedBuilder()
        .setTitle(':pencil: Reprimand Appeal form')
        .addFields(
          { name: 'Status', value: 'Pending approval' },
          { name: 'Sent in by', value: `<@${interaction.user.id}>` },
          { name: ':link: Reprimand link', value: `[Go to reprimand](${link})` },
          { name: ':exclamation: Reason for appeal', value: reason },
          { name: ':mag: Proof', value: proof }
        )
        .setColor('Yellow')
        .setTimestamp();
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('approve_appeal').setLabel('Approve').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('reject_appeal').setLabel('Reject').setStyle(ButtonStyle.Danger)
        );
      const chan = await client.channels.fetch(APPEAL_CHANNEL_ID);
      const sent = await chan.send({ content: hadMention, embeds: [embed], components: [row] });
      appealForms.set(sent.id, interaction.user.id);
      await postAppealSystem(chan);
      return;
    }
    // Reject Appeal modal
    if (id.startsWith('reject_appeal_modal:')) {
      await interaction.deferReply({ ephemeral: true});
      const reason = interaction.fields.getTextInputValue('rejection_reason');
      const msgId = id.split(':')[1];
      const appealChan = await client.channels.fetch(APPEAL_CHANNEL_ID);
      const appMsg = await appealChan.messages.fetch(msgId).catch(() => null);
      if (!appMsg) return;
      const formUserId = appealForms.get(appMsg.id);
      const embedApp = EmbedBuilder.from(appMsg.embeds[0]).setColor('Red').setTimestamp();
      const fieldsApp = embedApp.data.fields.map(f => f.name === 'Status' ? { name: 'Status', value: 'Rejected' } : f);
      fieldsApp.push(
        { name: 'Rejection reason', value: `\`\`\`${reason}\`\`\`` },
        { name: ':man_judge: Rejected by', value: `<@${interaction.user.id}>` }
      );
      embedApp.setFields(fieldsApp);
      appealForms.delete(appMsg.id);
      await appMsg.edit({ embeds: [embedApp], components: [] });
      // DM user their rejection
      try {
        const user = await client.users.fetch(formUserId);
        const dmEmbed = new EmbedBuilder()
          .setTitle('Your Reprimand appeal was rejected')
          .addFields(
            { name: ':exclamation: Reason', value: '```' + reason + '```' },
            { name: ':link: Appeal form', value: `[Go to appeal form](https://discord.com/channels/${GUILD_ID}/${APPEAL_CHANNEL_ID}/${appMsg.id})` }
          )
          .setColor('Red')
          .setTimestamp();
        await user.send({ embeds: [dmEmbed] });
      } catch {}
      return;
    }
  }
});

client.login(TOKEN);
