import { botProfile } from "../models/shared.model";

export class BotService {
  //
  read = async ({ page, limit }: { page: number; limit: number }) => {
    const skip = (page - 1) * limit;
    return await botProfile.find().skip(skip).limit(limit).exec();
  };

  //
  readById = async (botId: string) => {
    return await botProfile.findById(botId).exec();
  };

  //
  create = async (botData: {
    botId: string;
    botName: string;
    botDesc?: string;
    baseModel: string;
    embedModel: string;
    toolModel: string;
    instruction: string;
    kbsearchMethod: string;
    vectorTable: string;
    publicAccess: boolean;
    owner?: any;
    isActive?: boolean;
    botUsers?: {
      users: Array<String>; // email addresses of users who can access the bot
      totalUsersCount: number;
    };
  }) => {
    const newBot = new botProfile(botData);
    return await newBot.save();
  };

  //
  updateById = async (
    botId: string,
    updateData: Partial<{
      botId: string;
      botName: string;
      botDesc?: string;
      baseModel: string;
      embedModel: string;
      toolModel: string;
      instruction: string;
      kbsearchMethod: string;
      vectorTable: string;
      publicAccess: boolean;
      owner?: any;
      isActive?: boolean;
      botUsers?: {
        users: Array<String>; // email addresses of users who can access the bot
        totalUsersCount: number;
      };
    }>,
  ) => {
    return await botProfile
      .findOneAndUpdate({ botId }, updateData, {
        new: true,
        runValidators: true,
      })
      .exec();
  };

  //
  deleteById = async (botId: string) => {
    return await botProfile.findOneAndDelete({ botId }).exec();

  };
}
