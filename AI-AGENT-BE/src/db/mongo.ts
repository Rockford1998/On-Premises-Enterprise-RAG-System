import mongoose from "mongoose";

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
    await mongoose.connect('mongodb://root:root@127.0.0.1:27017/poc?authSource=admin');
    console.log("MongoDB connected successfully");
}