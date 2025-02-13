const express = require('express')
// const app = express()
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);
const port = 8081;
const connection = require('./config/db')
require('dotenv').config();
const cors = require('cors');

app.use(cors())
app.use(express.json())

app.set('view engine','ejs')
app.get('/',(req,res)=>{
    res.send('welcome')
})

let userRouter = require('./routes/userRoutes')
let mailRouter = require('./routes/mailRoutes');
const User = require('./models/User');

app.use('/users',userRouter)
app.use('/email',mailRouter)

let usersMap = new Map()

io.on('connection', (socket) => {
    // console.log(socket.id);
    socket.on('adduser',(userId)=>{
        console.log(socket.id,userId);
        usersMap.set(userId, socket.id)
        console.log(usersMap);
        

    })

socket.on('sendMsg',async(ans)=>{
    console.log(ans);  
    console.log(ans);
    console.log('ans ',ans);

    let friendId = await User.findOne({email: ans.to})
    console.log(friendId);
    console.log(friendId._id.toString());
    let friendSocket = usersMap.get(friendId._id.toString())
    console.log('friendSocket ',friendSocket);
    if(friendSocket){
        io.to(friendSocket).emit('recieveMsg',ans);
    } 
    
}) 
});

server.listen(port,()=>{
    console.log(`server is runing on port ${port}`);
    connection()
    
})