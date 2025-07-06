import mongoose from 'mongoose';

const knowledgeBaseSchema = new mongoose.Schema(
    {
        fileName: {
            type: String,
            required: true,
            trim: true,
        },
        content: {
            type: String,
            required: true,
        },
        source: {
            type: String,
            required: true,
            trim: true,
        },
        fileHash: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        type: {
            type: String,
            required: true,
            trim: true,
        },
    },
    {
        timestamps: true, // Automatically adds createdAt and updatedAt
    }
);

export const KnowledgeBase = mongoose.model('KnowledgeBase', knowledgeBaseSchema);
