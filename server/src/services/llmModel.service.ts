import { llmModel } from "../models/shared.model";

export class LlmModelService {

    // List models with optional filters and pagination
    read = async ({ page = 1, limit = 20, provider, isActive }: { page?: number; limit?: number; provider?: string; isActive?: boolean }) => {
        const query: any = {};
        if (provider) query.provider = provider;
        if (typeof isActive === "boolean") query.isActive = isActive;

        const models = await llmModel.find(query)
            .skip((page - 1) * limit)
            .limit(limit)
            .exec();

        return models;
    };

    readAll = async () => {
        return await llmModel.find().select('name _id').lean().exec();
    };


    // Read by  _id
    readById = async (id: string) => {
        return await llmModel.findById(id).exec();
    };

    // Read by model name (unique)
    readByName = async (name: string) => {
        return await llmModel.findOne({ name }).exec();
    };

    // Create a new LLM model entry
    create = async (modelData: {
        name: string;
        provider: string;
        endpoint?: string;
        isActive?: boolean;
        meta: {
            contextWindow: number;
            modelType: string;
            inputPrice?: number;
            outputPrice?: number;
            inputType: string
        };
    }) => {
        const newModel = new llmModel(modelData);
        return await newModel.save();
    };

    // Update a model by id
    updateById = async (id: string, updateData: Partial<{
        name: string;
        provider: string;
        endpoint?: string;
        isActive?: boolean;
        meta?: {
            contextWindow?: number;
            type?: string;
            inputPrice?: number;
            outputPrice?: number;
        };
    }>) => {
        return await llmModel.findByIdAndUpdate(id, updateData, { new: true, runValidators: true }).exec();
    };

    // Delete a model by id
    deleteById = async (id: string) => {
        return await llmModel.findByIdAndDelete(id).exec();
    };

    findModelsForBot = async (botSpecs: { baseModel?: string; embedModel?: string; toolModel?: string }) => {
        const names = [] as string[];
        if (botSpecs.baseModel) names.push(botSpecs.baseModel);
        if (botSpecs.embedModel) names.push(botSpecs.embedModel);
        if (botSpecs.toolModel) names.push(botSpecs.toolModel);

        if (names.length === 0) return [];

        return await llmModel.find({ name: { $in: names }, isActive: true }).exec();
    };

}