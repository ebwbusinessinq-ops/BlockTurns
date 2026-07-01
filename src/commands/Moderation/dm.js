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
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("dm")
        .setDescription("Send a formatted direct message to multiple users (Staff only)")
        .addStringOption(option =>
            option
                .setName("users")
                .setDescription("Provide User IDs separated by spaces or commas")
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
        const rawUsersString = interaction.options.getString("users");
        const anonymous = interaction.options.getBoolean("anonymous") || false;
        const attachment = interaction.options.getAttachment("attachment");

        // Split by commas or spaces and filter out empty strings
        const userIds = rawUsersString.split(/[\s,]+/).filter(id => id.trim().length > 0);

        if (userIds.length === 0) {
            return await interaction.reply({
                content: '❌ Please provide at least one valid User ID.',
                flags: [MessageFlags.Ephemeral]
            });
        }

        const sessionToken = Math.random().toString(36).substring(2, 8);

        // 1. Create the Modal popup configuration for paragraphs
        const modal = new ModalBuilder()
            .setCustomId(`dm_modal_${sessionToken}`)
            .setTitle(`Send Bulk DM (${userIds.length} targets)`);

        const messageInput = new TextInputBuilder()
            .setCustomId('dm_message_text')
            .setLabel('Message Content (Supports Markdown)')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('**Bold**, *Italics*, __Underlines__, \nShift+Enter for new lines...\n\n> Blockquotes work too!')
            .setMaxLength(2000)
            .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(messageInput);
        modal.addComponents(firstActionRow);

        // 2. Display the pop-up modal directly to the staff member
        await interaction.showModal(modal);

        // 3. Catch and collect the submitted data
        try {
            const filter = (i) => i.customId === `dm_modal_${sessionToken}` && i.user.id === interaction.user.id;
            const submitted = await interaction.awaitModalSubmit({ filter, time: 300000 }); // 5 minutes window

            // Defer immediately to give processing room
            await submitted.deferReply();

            // RELEVANT CHANGE: Bypassing strict markdown escaping so formatting renders correctly
            const formattedMessage = submitted.fields.getTextInputValue('dm_message_text');

            // Build the customized staff embed 
            const dmEmbed = createEmbed({
                title: anonymous ? "📬 Message from the Staff Team" : `📬 Message from ${interaction.user.tag}`,
                description: formattedMessage, // Renders your lines, bolds, underlines, etc.
                color: '#5865F2', 
            }).setFooter({
                text: `You cannot reply to this message. | Logger ID: ${submitted.id}`
            }).setTimestamp();

            if (attachment && attachment.contentType?.startsWith('image/')) {
                dmEmbed.setImage(attachment.url);
            }

            const payload = { embeds: [dmEmbed] };

            if (attachment && !attachment.contentType?.startsWith('image/')) {
                payload.files = [attachment.url];
            }

            const successfulDms = [];
            const failedDms = [];

            // Loop through each ID provided
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

                    // Log the action systematically
                    await logEvent({
                        client: submitted.client,
                        guild: submitted.guild,
                        event: {
                            action: "DM Sent (Bulk)",
                            target: `${targetUser.tag} (${targetUser.id})`,
                            executor: `${submitted.user.tag} (${submitted.user.id})`,
                            reason: `Anonymous: ${anonymous ? 'Yes' : 'No'} | Has Attachment: ${attachment ? 'Yes' : 'No'}`,
                            metadata: {
                                userId: targetUser.id,
                                moderatorId: submitted.user.id,
                                anonymous,
                                messageLength: formattedMessage.length,
                                hasFile: !!attachment
                            }
                        }
                    });

                } catch (err) {
                    logger.error(`Failed to bulk DM user ID ${id}:`, err);
                    if (err.code === 50007) {
                        failedDms.push(`${id} (DMs closed/blocked)`);
                    } else {
                        failedDms.push(`${id} (Invalid ID/Fetch error)`);
                    }
                }
            }

            // Construct feedback summary
            let resultDescription = `### Delivery Summary:\n✅ **Successful:** ${successfulDms.length}\n❌ **Failed:** ${failedDms.length}`;
            
            if (successfulDms.length > 0) {
                resultDescription += `\n\n**Sent to:** ${successfulDms.map(tag => `\`${tag}\``).join(', ')}`;
            }
            if (failedDms.length > 0) {
                resultDescription += `\n\n**Failed for:**\n${failedDms.map(f => `• ${f}`).join('\n')}`;
            }

            // Confirm delivery back to the staff user
            return await InteractionHelper.safeEditReply(submitted, {
                embeds: [
                    successEmbed(
                        "Bulk DM Processing Complete",
                        resultDescription
                    ),
                ],
            });

        } catch (error) {
            if (error.code === 'InteractionCollectorError') {
                return;
            }
            logger.error('DM command modal process error:', error);
        }
    }
};
