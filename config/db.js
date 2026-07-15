import mongoose from "mongoose";
async function connectToDb(){

try {
    let connection = await mongoose.connect(process.env.MONGO_URL)

} catch (error) {

}
}
//('mongodb://127.0.0.1:27017/mailBox')
export default connectToDb