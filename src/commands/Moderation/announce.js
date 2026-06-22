import { 
    SlashCommandBuilder, 
    PermissionFlagsBits, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ActionRowBuilder,
    ChannelType,
    MessageFlags 
} from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { sanitizeMarkdown } from '../../utils/validation.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("announce")
        .setDescription("Send a stylized embed announcement to a specific channel")
        .addChannelOption(option =>
            option
                .setName("channel")
                .setDescription("The channel to post the announcement in")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("colour")
                .setDescription("The embed accent colour (Hex code like #ff0000 or color name like Red, Blue, Green)")
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option
                .setName("attachment")
                .setDescription("Attach an image or file to display inside the announcement")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false),
    category: "utility",

    async execute(interaction, config, client) {
        const targetChannel = interaction.options.getChannel("channel");
        const colorInput = interaction.options.getString("color") || "#5865F2";
        const attachment = interaction.options.getAttachment("attachment");

        // Check if the bot can send messages in the target channel
        if (!targetChannel.permissionsFor(client.user).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
            return await interaction.reply({ 
                content: `❌ I do not have permissions to send embeds or messages in ${targetChannel}.`, 
                flags: [MessageFlags.Ephemeral] 
            });
        }

        // 1. Setup the modal popup configurations
        const modal = new ModalBuilder()
            .setCustomId(`announce_modal_${targetChannel.id}`)
            .setTitle(`Create Announcement`);

        const titleInput = new TextInputBuilder()
            .setCustomId('announce_title')
            .setLabel('Announcement Title')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter a catchy title...')
            .setMaxLength(256)
            .setRequired(true);

        const messageInput = new TextInputBuilder()
            .setCustomId('announce_message_text')
            .setLabel('Announcement Content')
            .setStyle(TextInputStyle.Paragraph) // Allows multi-line layout formatting
            .setPlaceholder('Type your detailed paragraph announcement here...')
            .setMaxLength(4000) // Discord embeds support up to 4000 characters in descriptions
            .setRequired(true);

        const row1 = new ActionRowBuilder().addComponents(titleInput);
        const row2 = new ActionRowBuilder().addComponents(messageInput);
        modal.addComponents(row1, row2);

        // 2. Open the form popup up for the staff member
        await interaction.showModal(modal);

        // 3. Catch and dispatch the announcement payload
        try {
            const filter = (i) => i.customId === `announce_modal_${targetChannel.id}` && i.user.id === interaction.user.id;
            const submitted = await interaction.awaitModalSubmit({ filter, time: 600000 }); // 10 minute window to draft

            await submitted.deferReply({ flags: [MessageFlags.Ephemeral] });

            const title = submitted.fields.getTextInputValue('announce_title');
            const message = submitted.fields.getTextInputValue('announce_message_text');
            const sanitizedMessage = sanitizeMarkdown(message);

            // Construct the stylized embed card
            const announceEmbed = createEmbed({
                title: `📢 ${title}`,
                description: sanitizedMessage,
                color: colorInput,
            }).setTimestamp();

            // Set the footer to represent your server space neatly
            if (interaction.guild.iconURL()) {
                announceEmbed.setFooter({ text: interaction.guild.name, iconURL: interaction.guild.iconURL() });
            } else {
                announceEmbed.setFooter({ text: interaction.guild.name });
            }

            // Handle images vs generic file uploads smoothly
            const payload = { embeds: [announceEmbed] };

            if (attachment) {
                if (attachment.contentType?.startsWith('image/')) {
                    announceEmbed.setImage(attachment.url);
                } else {
                    payload.files = [attachment.url];
                }
            }

            // Dispatch notice directly to the chosen channel environment
            const sentMessage = await targetChannel.send(payload);

            // Log it inside your audit system structures
            await logEvent({
                client: submitted.client,
                guild: submitted.guild,
                event: {
                    action: "Announcement Sent",
                    target: `${targetChannel.name} (${targetChannel.id})`,
                    executor: `${submitted.user.tag} (${submitted.user.id})`,
                    reason: `Title: ${title}`,
                    metadata: {
                        channelId: targetChannel.id,
                        moderatorId: submitted.user.id,
                        hasAttachment: !!attachment,
                        messageLength: sanitizedMessage.length
                    }
                }
            });

            // Return clean ephemeral visual receipt confirmation to the coordinator
            return await InteractionHelper.safeEditReply(submitted, {
                embeds: [
                    successEmbed(
                        "Announcement Dispatched Successfully!",
                        `Your announcement has been broadcasted cleanly over inside ${targetChannel}.\n\n[Jump to Announcement](${sentMessage.url})`
                    ),
                ],
            });

        } catch (error) {
            if (error.code === 'InteractionCollectorError') {
                return; // User walked away or canceled out of the prompt fields
            }

            logger.error('Announce command modal process execution failure:', error);
            
            return await interaction.followUp({ 
                content: `❌ An unexpected system exception happened while dispatching: ${error.message}`, 
                flags: [MessageFlags.Ephemeral] 
            }).catch(() => null);
        }
    }
};
