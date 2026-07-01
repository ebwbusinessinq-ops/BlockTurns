import { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder,
    MessageFlags,
    EmbedBuilder
} from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("dm")
        .setDescription("Send a beautifully formatted direct message to multiple users")
        .addStringOption(option =>
            option
                .setName("users")
                .setDescription("Provide User IDs separated by spaces or commas")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("title")
                .setDescription("Custom title for the embed (e.g., 'Official Server Notice')")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("color")
                .setDescription("Hex color code for the side border (e.g., #ff0000)")
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option
                .setName("attachment")
                .setDescription("Attach an image or file to include at the bottom")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("banner_url")
                .setDescription("Direct image URL to display as a large top banner")
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName("anonymous")
                .setDescription("Hide your staff name from the message (default: false)")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false),
    category: "moderation",

    async execute(interaction, config, client) {
        const rawUsersString = interaction.options.getString("users");
        const customTitle = interaction.options.getString("title");
        const customColor = interaction.options.getString("color") || '#5865F2';
        const bannerUrl = interaction.options.getString("banner_url");
        const anonymous = interaction.options.getBoolean("anonymous") || false;
        const attachment = interaction.options.getAttachment("attachment");

        const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
        const embedColor = hexRegex.test(customColor) ? customColor : '#5865F2';

        const userIds = rawUsersString.split(/[\s,]+/).filter(id => id.trim().length > 0);

        if (userIds.length === 0) {
            return await interaction.reply({
                content: '❌ Please provide at least one valid User ID.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        const sessionToken = Math.random().toString(36).substring(2, 8);

        const modal = new ModalBuilder()
            .setCustomId(`dm_modal_${sessionToken}`)
            .setTitle(`Message Content Configuration`);

        const messageInput = new TextInputBuilder()
            .setCustomId('dm_message_text')
            .setLabel('Message Body (Supports Discord Markdown)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('### 📢 Important Announcement\n\nWrite your primary message here...\n\nUse standard markdown elements to decorate sections.')
            .setMaxLength(2000)
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(messageInput);
        modal.addComponents(firstActionRow);

        await interaction.showModal(modal);

        try {
            const filter = (i) => i.customId === `dm_modal_${sessionToken}` && i.user.id === interaction.user.id;
            const submitted = await interaction.awaitModalSubmit({ filter, time: 300000 });

            await submitted.deferReply();

            const formattedMessage = submitted.fields.getTextInputValue('dm_message_text');

            const defaultTitle = anonymous ? "📬 Official Staff Team Notice" : `📬 Message from ${interaction.user.tag}`;
            const finalTitle = customTitle ? `📬 ${customTitle}` : defaultTitle;

            const dmEmbed = createEmbed({
                title: finalTitle,
                description: `${formattedMessage}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n*This is an automated delivery. Direct replies are not monitored.*`,
                color: embedColor, 
            }).setFooter({
                text: `Security Log Reference ID: ${submitted.id}`
            }).setTimestamp();

            if (bannerUrl && (bannerUrl.startsWith('http://') || bannerUrl.startsWith('https://'))) {
                dmEmbed.setImage(bannerUrl);
            }

            if (attachment && attachment.contentType?.startsWith('image/') && !bannerUrl) {
                dmEmbed.setImage(attachment.url);
            }

            const payload = { embeds: [dmEmbed] };

            if (attachment && !attachment.contentType?.startsWith('image/')) {
                payload.files = [attachment.url];
            }

            const successfulDms = [];
            const failedDms = [];

            for (const id of userIds) {
                try {
                    const targetUser = await client.users.fetch(id);

                    if (targetUser.bot) {
                        failedDms.push(`${id} (Bot account)`);
                        continue;
                    }

                    const dmChannel = await targetUser.createDM();
                    await dmChannel.send(payload);
                    successfulDms.push(targetUser.tag);

                    // Safely try logging, catch silently if logging infrastructure config is missing
                    await logEvent({
                        client: submitted.client,
                        guild: submitted.guild,
                        event: {
                            action: "DM Sent (Bulk Premium)",
                            target: `${targetUser.tag} (${targetUser.id})`,
                            executor: `${submitted.user.tag} (${submitted.user.id})`,
                            reason: `Title: ${finalTitle} | Color: ${embedColor}`,
                            metadata: {
                                userId: targetUser.id,
                                moderatorId: submitted.user.id,
                                anonymous,
                                messageLength: formattedMessage.length,
                                hasFile: !!attachment
                            }
                        }
                    }).catch(() => null);

                } catch (err) {
                    logger.error(`Failed to bulk DM user ID ${id}:`, err);
                    if (err.code === 50007) {
                        failedDms.push(`${id} (DMs closed/blocked)`);
                    } else {
                        failedDms.push(`${id} (Invalid ID/Fetch error)`);
                    }
                }
            }

            // Build native Embed confirmation structure completely independent of custom framework config files
            let resultDescription = `### Delivery Summary:\n✅ **Successful:** ${successfulDms.length}\n❌ **Failed:** ${failedDms.length}`;
            
            if (successfulDms.length > 0) {
                resultDescription += `\n\n**Sent to:** ${successfulDms.map(tag => `\`${tag}\``).join(', ')}`;
            }
            if (failedDms.length > 0) {
                resultDescription += `\n\n**Failed for:**\n${failedDms.map(f => `• ${f}`).join('\n')}`;
            }

            const nativeReportEmbed = new EmbedBuilder()
                .setTitle("⚙️ Bulk DM Processing Complete")
                .setDescription(resultDescription)
                .setColor("#2ECC71")
                .setTimestamp();

            return await InteractionHelper.safeEditReply(submitted, {
                embeds: [nativeReportEmbed],
            });

        } catch (error) {
            if (error.code === 'InteractionCollectorError') {
                return;
            }
            logger.error('DM command modal process error:', error);
        }
    }
};
