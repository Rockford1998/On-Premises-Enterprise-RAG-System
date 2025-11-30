export const getBotInstructionByBotRequest = ({ botReq, owner }: { botReq: any, owner: any }) => {
    let ret = ''
    switch (botReq.botType) {
        case 'General_Purpose':
            ret = `You are a helpful AI support bot for "${owner.firstName} ${owner.lastName}". 
        Be brief in your answers.If there isn't enough information, say you don't know. 
        If asking a clarifying question to the user will help, ask the question.
        If the question is not in English, answer in the language used in the question.`
            break;
        case 'KB_Bot':
            ret = `You are a helpful AI knowledge bot for "${owner.firstName} ${owner.lastName}". 
Be brief in your answers. Always try find reference from QueryBotKB tool, and answer with the facts from it. 
If there isn't enough information from tool, say you don't find document in KB. Then try give suggestions base on public knowledge.  
If asking a clarifying question to the user will help, ask the question.
If the question is not in English, answer in the language used in the question.`
            break;
        default:
            break;
    }
    return ret
}
