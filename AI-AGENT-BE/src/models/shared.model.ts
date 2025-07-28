import mongoose from 'mongoose';
// /////////////////////////////////////////////////////////////////////////// NOTE SYSTEM SETTINGS WILL BE ADDED LATER ///////////////////////////////////////////////////////////////////////////
// users
// This model is used to store the user profiles
const userSchema = new mongoose.Schema({
    firstName: { type: String, required: true, trim: true, },
    lastName: { type: String, required: true, trim: true, },
    userName: { type: String, required: true, unique: true, trim: true, },
    email: { type: String, required: true, unique: true, trim: true, },
    passwordHash: { type: String, required: true, },
    isActive: { type: Boolean, default: true, },
}, { timestamps: true });
userSchema.index({ userName: 1 });
userSchema.index({ email: 1 });


// Bot profile
// This model is used to store the bot profiles
const botProfileSchema = new mongoose.Schema({
    botName: { type: String, required: true, trim: true, },
    botDescription: { type: String, trim: true, },
    description: { type: String, trim: true, },
    isActive: { type: Boolean, default: true, },
    owner: {},
    botUsers: {
        users: [], // email addresses of users who can access the bot
        totalUsersCount: { type: Number, default: 0, },
    },
}, { timestamps: true });
botProfileSchema.index({ botName: 1 });
botProfileSchema.index({ owner: 1 });


// Knowledge Base
// This model is used to store the knowledge base entries for each bot
const knowledgeBaseSchema = new mongoose.Schema(
    {
        botId: { type: String, required: true, }, // Reference to the bot this knowledge base belongs to
        fileName: { type: String, required: true, trim: true, },
        fileSize: { type: Number, required: true, },
        content: { type: String, required: true, },
        source: { type: String, required: true, trim: true, },
        fileHash: { type: String, required: true, trim: true, index: true, },
        type: { type: String, required: true, trim: true, },
        downloadUrl: { type: String, required: true, },
    },
    { timestamps: true, }
);
knowledgeBaseSchema.index({ botId: 1 })
knowledgeBaseSchema.index({ fileName: 1 });


export const user = mongoose.model('user', userSchema);
export const botProfile = mongoose.model('botProfile', botProfileSchema);
export const KnowledgeBase = mongoose.model('KnowledgeBase', knowledgeBaseSchema);
