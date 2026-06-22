import { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder,
    MessageFlags 
} from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { sanitizeMarkdown } from '../../utils/validation.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("dm")
        .setDescription("Send a direct message to a user (Staff only)")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("The user to send a DM to")
                .setRequired(true)
        )
        .addAttachmentOption(option =>
            option
                .setName("attachment")
                .setDescription("Attach an image or file to include in the DM")
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName("anonymous")
                .setDescription("Send the message anonymously (default: false)")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false),
    category: "moderation",

    async execute(interaction, config, client) {
        const targetUser = interaction.options.getUser("user");
        const anonymous = interaction.options.getBoolean("anonymous") || false;
        const attachment = interaction.options.getAttachment("attachment");

        // Prevent trying to message bots
        if (targetUser.bot) {
            return await interaction.reply({ 
                content: '❌ You cannot send DMs to bot accounts.', 
                flags: [MessageFlags.Ephemeral] 
            });
        }

        // 1. Create the Modal popup configuration for paragraphs
        const modal = new ModalBuilder()
            .setCustomId(`dm_modal_${targetUser.id}_${anonymous}`)
            .setTitle(`DM to ${targetUser.username}`);

        const messageInput = new TextInputBuilder()
            .setCustomId('dm_message_text')
            .setLabel('Message Content')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Type your paragraph message here...')
            .setMaxLength(2000)
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(messageInput);
        modal.addComponents(firstActionRow);

        // 2. Display the pop-up modal directly to the staff member
        await interaction.showModal(modal);

        // 3. Catch and collect the submitted data
        try {
            const filter = (i) => i.customId === `dm_modal_${targetUser.id}_${anonymous}` && i.user.id === interaction.user.id;
            const submitted = await interaction.awaitModalSubmit({ filter, time: 300000 }); // 5 minutes window

            // Defer immediately to give processing room
            await submitted.deferReply();

            const message = submitted.fields.getTextInputValue('dm_message_text');
            const sanitized = sanitizeMarkdown(message);

            // CUSTOMIZATION: Build the customized staff embed 
            const dmEmbed = createEmbed({
                title: anonymous ? "📬 Message from the Staff Team" : `📬 Message from ${interaction.user.tag}`,
                description: sanitized,
                color: '#5865F2', // Custom embed color accent (Blurple)
            }).setFooter({
                text: `You cannot reply to this message. | Logger ID: ${submitted.id}`
            }).setTimestamp(); // Adds a timestamp to the message

            // If an attachment exists and it's an image, render it inside the embed nicely
            if (attachment && attachment.contentType?.startsWith('image/')) {
                dmEmbed.setImage(attachment.url);
            }

            // Prepare sending payload
            const payload = { embeds: [dmEmbed] };

            // If it's a non-image file attachment (e.g., pdf, zip), attach it as a download link/file
            if (attachment && !attachment.contentType?.startsWith('image/')) {
                payload.files = [attachment.url];
            }

            // Open the DM channel and deliver the notice
            const dmChannel = await targetUser.createDM();
            await dmChannel.send(payload);

            // Log the action systematically
            await logEvent({
                client: submitted.client,
                guild: submitted.guild,
                event: {
                    action: "DM Sent",
                    target: `${targetUser.tag} (${targetUser.id})`,
                    executor: `${submitted.user.tag} (${submitted.user.id})`,
                    reason: `Anonymous: ${anonymous ? 'Yes' : 'No'} | Has Attachment: ${attachment ? 'Yes' : 'No'}`,
                    metadata: {
                        userId: targetUser.id,
                        moderatorId: submitted.user.id,
                        anonymous,
                        messageLength: sanitized.length,
                        hasFile: !!attachment
                    }
                }
            });

            // Confirm delivery back to the staff user
            return await InteractionHelper.safeEditReply(submitted, {
                embeds: [
                    successEmbed(
                        "DM Sent Successfully",
                        `Your message has been delivered to ${targetUser.tag}.`
                    ),
                ],
            });

        } catch (error) {
            if (error.code === 'InteractionCollectorError') {
                return; // User closed modal or timed out
            }

            logger.error('DM command modal process error:', error);
            
            // Catch DMs turned off/blocked privacy exceptions
            if (error.code === 50007) {
                return await interaction.followUp({ 
                    content: `❌ Could not send a DM to ${targetUser.tag}. They may have DMs disabled or blocked.`, 
                    flags: [MessageFlags.Ephemeral] 
                }).catch(() => null);
            }
        }
    }
};
