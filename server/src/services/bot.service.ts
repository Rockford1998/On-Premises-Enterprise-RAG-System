import { botProfile } from "../models/shared.model";

export class BotService {
  //
  read = async ({ page = 1, limit = 10, users }: { page: number, limit: number, users?: string }) => {
    const query: any = {};

    if (users) {
      query["botUsers.users"] = users; // Matches if the array contains the email
    }

    const bots = await botProfile.find(query)
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-owner.password');;

    return bots;
  };

  //
  readByBotId = async (botId: string) => {
    return await botProfile.findOne({ botId }).select('-owner.password').exec();
  };
  //

  readByBotOwner = async (owner: string) => {
    return await botProfile.find({ "owner.email": owner }).select('-owner.password').exec();
  };


  //
  create = async (botData: {
    botId: string;
    botName: string;
    botDesc?: string;
    botType: string
    baseModel: {};
    embedModel: {};
    toolModel: {};
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
    stats: {
      apiTokenCount: number,
      kbDocCount: number,
      kbDocSize: number,
      kbVectorCount: number,
      chatMsgCount: number,           // message count in 30 days
    },
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
      baseModel: {};
      embedModel: {};
      toolModel: {};
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
