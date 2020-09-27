const { Console } = require("console")
const express = require("express")
const app = express()

const server = require("http").createServer(app)
const io = require("socket.io")(server)

const port = process.env.PORT || 5000

server.listen(port, () => console.log(`Server running on ${port}`))

const roomcodes = []
const gameRooms = []

io.on("connect", socket => {
  let currUser
  console.log(`User(${socket.id}) connected`)

  // Sends user socket id to the client when the connection established
  socket.emit('user connect', socket.id)

  // User creates game-room
  socket.on('game created', roomInfo => {
    roomInfo.roomcode = generatesRoomcode()
    gameRooms.push(roomInfo)
    socket.emit('send roomcode', roomInfo)
  })

  // User search game-room
  socket.on('find room', roomCode => {
    if(roomcodes.includes(roomCode)) {
      socket.emit('room found', gameRooms[gameRooms.findIndex(room => room.roomcode === roomCode)])
    } else {
      socket.emit('room not found')
    }
  })

  // User disconnects
  socket.on('disconnect', () => {
    
  })
})

function generatesRoomcode() {
  const alphabets = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  
  while(true) {
    const generatedCode = 
    alphabets.charAt(Math.floor(Math.random() * alphabets.length)) +
    alphabets.charAt(Math.floor(Math.random() * alphabets.length)) +
    alphabets.charAt(Math.floor(Math.random() * alphabets.length)) +
    alphabets.charAt(Math.floor(Math.random() * alphabets.length))

    if (roomcodes.length > 456976) {
      return "Rooms are full"
    } else if (!roomcodes.includes(generatedCode)) {
      roomcodes.push(generatedCode)
      return generatedCode
    }
  }
}