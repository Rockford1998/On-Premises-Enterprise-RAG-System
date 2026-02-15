import mongoose from "mongoose";
const mongoDbUrl = process.env.MONGODB_URL;

mongoose.connection.on('connected', () => {
    console.log("Mongoose connected to MongoDB");
});

mongoose.connection.on('error', (err) => {
    console.error("Mongoose connection error:", err);
});

mongoCnnection().catch(err => {
    console.error("MongoDB connection error:", err);
});

export async function mongoCnnection() {
    console.log("Connecting to MongoDB...", mongoDbUrl);
    if (!mongoDbUrl) {
        throw new Error("MONGODB_URL environment variable is not set");
    }
    await mongoose.connect(mongoDbUrl);
    console.log("MongoDB connected successfully");
}



