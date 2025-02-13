const mongoose= require('mongoose')




async function connectToDb(){

try {
    let connection = await mongoose.connect(process.env.MONGO_URI)
    console.log('Connected to mongodb successfully!');
} catch (error) {
  console.log('error in connecting mongodb!',error);
}
}
//('mongodb://127.0.0.1:27017/mailBox')
module.exports  = connectToDb