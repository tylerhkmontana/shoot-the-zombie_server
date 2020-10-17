const express = require("express")
const { join } = require("path")
const { clearInterval } = require("timers")
const app = express()

const server = require("http").createServer(app)
const io = require("socket.io")(server)

const port = process.env.PORT || 5000

server.listen(port, () => console.log(`Server running on ${port}`))

const roomcodes = []
const gameRooms = []
const inGameRooms = []

io.on("connect", socket => {
  let currUser
  let joinedRoom
  let isInGame = false

  console.log(`User(${socket.id}) connected`)

  // Sends user socket id to the client when the connection established
  socket.emit('user connect', socket.id)

  socket.on('user enter', userName => {
    currUser = {
      userName,
      id: socket.id
    }
  })

  // User creates game-room
  socket.on('game created', roomInfo => {
    joinedRoom = generatesRoomcode()

    roomInfo.roomcode = joinedRoom
    roomInfo.players = [currUser]
    gameRooms.push(roomInfo)
    socket.join(joinedRoom)

    socket.emit('send roomInfo', roomInfo)
  })

  // User search game-room
  socket.on('find room', targetRoomcode => {
    if(roomcodes.includes(targetRoomcode)) {
      const gameroomIndex = findRoomIndex(targetRoomcode)
      if (gameRooms[gameroomIndex].players.length === gameRooms[gameroomIndex].numPlayers) {
        socket.emit('full house')
      } else {
        gameRooms[gameroomIndex].players.push(currUser)
        joinedRoom = gameRooms[gameroomIndex].roomcode
  
        socket.join(joinedRoom)
        socket.emit('room found', gameRooms[gameroomIndex])
        socket.to(joinedRoom).emit('user join gameroom', gameRooms[gameroomIndex])
      }
    } else {
      socket.emit('room not found')
    }
  })

  // Roomaster starts the game
  socket.on('start game', inGameRoomInfo => {
    isInGame = true

    inGameRoomInfo.players = appointToRoles(inGameRoomInfo.players)
    
    inGameRooms.push(inGameRoomInfo)
    socket.to(joinedRoom).emit('game started')
    console.log(inGameRoomInfo)
  })

  // User enters the in-game
  socket.on('what is my role', userId => {
    const currGameRoomIndex = inGameRooms.findIndex(gameRoom => gameRoom.roomcode === joinedRoom)

    let currGamePlayers = [...inGameRooms[currGameRoomIndex].players]
    let myRole = currGamePlayers[currGamePlayers.findIndex(player => player.id === userId)].role

    if (myRole === 'zombie') {
      socket.emit('appointed to zombie')
    } else if (myRole === 'leader') {
      socket.emit('appointed to leader')
    } else {
      socket.emit('appointed to civilian')
    }
  
  }) 

  // User disconnects
  socket.on('disconnect', () => {
    isInGame = false
    if (joinedRoom) {
      const gameroomIndex = findRoomIndex(joinedRoom)
      const playerIndex = gameRooms[gameroomIndex].players.findIndex(player => player.id === socket.id)
      gameRooms[gameroomIndex].players.splice(playerIndex, 1)

      if (gameRooms[gameroomIndex].players.length === 0) {
        gameRooms.splice(gameroomIndex, 1)
        roomcodes.splice(roomcodes.indexOf(joinedRoom), 1)
      } else {
        socket.to(joinedRoom).emit('user leave gameroom', {
          roomInfo: gameRooms[gameroomIndex],
          leavingUser: currUser
        })
      }
    }
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

function findRoomIndex(roomcode) {
  return roomcodes.includes(roomcode) ?
    gameRooms.findIndex(room => room.roomcode === roomcode) :
    -1
}

function appointToRoles(players) {
  let numPlayers = players.length
  const zombieIndex = Math.floor(Math.random() * numPlayers)
  const civilLeaderIndex = (zombieIndex + Math.floor(Math.random() * (numPlayers - 1) + 1)) % numPlayers
  
  players.forEach((player, i) => {
    if(i === zombieIndex) {
      player.role = "zombie"
      console.log(`${player.userName} became the zombie!!`)
    } else if(i === civilLeaderIndex) {
      player.role = "leader"
      console.log(`${player.userName} became the leader!!`)
    } else {
      player.role = "civilian"
    }
  })

  return players
}