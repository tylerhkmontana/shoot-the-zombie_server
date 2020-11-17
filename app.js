const express = require("express")
const { clearInterval } = require("timers")
const app = express()
const axios = require("axios")
const path = require("path")
const server = require("http").createServer(app)
const io = require("socket.io")(server)

if (process.env.NODE_ENV !== 'production') {
  require("dotenv").config()
}

const giphyApiKey = process.env.GIPHY_API_KEY
const port = process.env.PORT || 5000

app.use(express.static(path.join(__dirname, '..', 'build')))
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'build', 'index.html'))
})

server.listen(port, () => console.log(`Server running on ${port}`))

const roomcodes = []
const gameRooms = []
const inGameRooms = []

io.on("connect", socket => {
  let currUser
  let joinedRoom

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
  socket.on('room created', roomInfo => {
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
      const gameroomIndex = findRoomIndex(targetRoomcode, gameRooms)
      if(findRoomIndex(targetRoomcode, inGameRooms) >= 0) {
        socket.emit('room in game')
      } else if(gameRooms[gameroomIndex].players.length === gameRooms[gameroomIndex].numPlayers) {
        socket.emit('full house')
      } else {
        gameRooms[gameroomIndex].players.push(currUser)
        joinedRoom = gameRooms[gameroomIndex].roomcode
  
        socket.join(joinedRoom)
        socket.emit('room found', gameRooms[gameroomIndex])
        socket.to(joinedRoom).emit('user join gameroom', gameRooms[gameroomIndex])
        socket.to(joinedRoom).emit('update message', `${currUser.userName} has joined the room`)
      }
    } else {
      socket.emit('room not found')
    }
  })

  // User exits the room
  socket.on("user exit room", () => {
    const gameroomIndex = findRoomIndex(joinedRoom, gameRooms)
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
      socket.to(joinedRoom).emit('update message', `${currUser.userName} has left the room`)
    }
    socket.leave(joinedRoom)
    joinedRoom = null
  })

  // Room Master starts the game
  socket.on('start game', async inGameRoomInfo => {
    io.in(joinedRoom).emit('game started')
    try {
      inGameRoomInfo.gifData = (await axios.get(giphyApiKey)).data.data
    } catch(err) {
      console.log(err)
      inGameRoomInfo.gifData = null
    }

    inGameRooms.push(inGameRoomInfo)
    const currInGameRoom = inGameRooms[findRoomIndex(joinedRoom, inGameRooms)]
    io.in(joinedRoom).emit('virus timer', currInGameRoom.gameSetting.infectionRate)
    currInGameRoom.status = {
      zombie: 1,
      civilian: currInGameRoom.numPlayers - 2,
      dead: 0
    }
    io.in(joinedRoom).emit('update status', currInGameRoom.status)
    appointToRoles(currInGameRoom.players)

    currInGameRoom.virusTimer = setInterval(() => {
      console.log("Spread VIRUS!!!")

      if(spreadVirus(currInGameRoom, io)) {
        clearInterval(currInGameRoom.virusTimer)
        inGameRooms.splice(findRoomIndex(joinedRoom, inGameRooms), 1)
      
        console.log("Game Over")
        
        io.in(joinedRoom).emit('Gameover', 'zombie')
        io.in(joinedRoom).emit('update message', 'GAME OVER...')
      }
    }, currInGameRoom.gameSetting.infectionRate)
  })

  socket.on("restart", () => {
    const currGameroom = {...gameRooms[findRoomIndex(joinedRoom, gameRooms)]}
    io.in(joinedRoom).emit("move to room", currGameroom)
  })

  //////////////////////////////////// SHERIFF /////////////////////////////////////////////
  
  // Appointed to sheriff and receive Sheriff's power
  socket.on("I am the sheriff", () => {
    const currGameRoomIndex = findRoomIndex(joinedRoom, inGameRooms)
    const numBullets = inGameRooms[currGameRoomIndex].gameSetting.numBullets
    const reloadInterval = inGameRooms[currGameRoomIndex].gameSetting.reloadInterval
    const targetPlayers = inGameRooms[currGameRoomIndex].players.filter(player => player.role !== 'sheriff' && player.role !== 'dead')

    socket.emit("receive bullets", { numBullets, targetPlayers, reloadInterval })
  })

  // Sheriff kills a player
  socket.on("sheriff shoots player", targetId => {
    const currInGameRoom = inGameRooms[findRoomIndex(joinedRoom, inGameRooms)]
    
    if(typeof currInGameRoom !== 'undefined' && currInGameRoom.gameSetting.numBullets > 0) {
        
      const [killedPlayer] = currInGameRoom.players.filter(player => player.id === targetId)
      currInGameRoom.gameSetting.numBullets-- 

      const whoIsKilled = killedPlayer.role
      killedPlayer.role = 'dead'

      whoIsKilled === 'zombie' ? currInGameRoom.status.zombie-- : currInGameRoom.status.civilian--
      currInGameRoom.status.dead++

      io.to(targetId).emit("you are dead")
      io.in(joinedRoom).emit("update status", currInGameRoom.status)
      io.in(joinedRoom).emit("update message", whoIsKilled === 'civilian' ? 
        `The Sheriff killed innocent civilian ${killedPlayer.userName}` : `The Sheriff killed zombie ${killedPlayer.userName}`)
 
      const targetPlayers = currInGameRoom.players.filter(player => player.role !== 'sheriff' && player.role !== 'dead')
      const leftCilvilians = targetPlayers.filter(player => player.role === 'civilian')
      const leftZombies = targetPlayers.filter(player => player.role === 'zombie')
      
      if(leftCilvilians.length === 0) {
        clearInterval(currInGameRoom.virusTimer)
        inGameRooms.splice(findRoomIndex(joinedRoom, inGameRooms), 1)

        console.log("GAME OVER, ZOMBIES WIN!!")
        io.in(joinedRoom).emit("update message", "GAME OVER...")
        io.in(joinedRoom).emit("Gameover", "zombie")
        
      } else if(leftZombies.length === 0) {
        clearInterval(currInGameRoom.virusTimer)
        inGameRooms.splice(findRoomIndex(joinedRoom, inGameRooms), 1)
        
        console.log("GAME OVER, CIVILIANS WIN!!")
        
        io.in(joinedRoom).emit("update message", "GAME OVER...")
        io.in(joinedRoom).emit("Gameover", "civilian")
        
      } else {
        if(whoIsKilled === 'civilian') {
          const [currSheriff] = currInGameRoom.players.filter(player => player.id === currUser.id)
          const newSheriff = leftCilvilians[Math.floor(Math.random() * leftCilvilians.length)]
          currSheriff.role = 'civilian'
          newSheriff.role = 'sheriff'
          io.in(joinedRoom).emit("update message", `${newSheriff.userName} became the new sheriff!`)
          io.to(newSheriff.id).emit("appointed to sheriff")
          socket.emit("appointed to civilian")
        } else {
          socket.emit("receive targetlist", targetPlayers)
        }
      }
    }
  })

  socket.on("reload bullet", async () => {
    const currInGameRoom = inGameRooms[findRoomIndex(joinedRoom, inGameRooms)]
    if (typeof currInGameRoom !== 'undefined')  {
      const targetPlayers = currInGameRoom.players.filter(player => player.role !== 'sheriff' && player.role !== 'dead')
      currInGameRoom.gameSetting.numBullets++

      try {
        currInGameRoom.gifData = (await axios.get(giphyApiKey)).data.data
      } catch(err) {
        console.log(err)
        currInGameRoom.gifData = null
      }

      io.in(joinedRoom).emit('gif updated', currInGameRoom.gifData)

      socket.emit("receive bullets", {
        numBullets: currInGameRoom.gameSetting.numBullets,
        reloadInterval: currInGameRoom.gameSetting.reloadInterval,
        targetPlayers
      })
    }
  })

  socket.on("request gif", () => {
    const gameroomIndex = findRoomIndex(joinedRoom, inGameRooms)
    const gifData = {...inGameRooms[gameroomIndex].gifData}
    socket.emit("response gif", gifData)
  })

  // User disconnects
  socket.on('disconnect', () => {
    if (joinedRoom) {
      const gameroomIndex = findRoomIndex(joinedRoom, gameRooms)
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
        socket.to(joinedRoom).emit('update message', `${currUser.userName} has left the room`)
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

function findRoomIndex(roomcode, gameRooms) {
  return roomcodes.includes(roomcode) ?
    gameRooms.findIndex(room => room.roomcode === roomcode) :
    -1
}

function appointToRoles(players) {
  let numPlayers = players.length
  const zombieIndex = Math.floor(Math.random() * numPlayers)
  const sheriffIndex = (zombieIndex + Math.floor(Math.random() * (numPlayers - 1) + 1)) % numPlayers
  
  players.forEach((player, i) => {
    if(i === zombieIndex) {
      player.role = "zombie"
      console.log(`${player.userName} became the zombie!!`)
    } else if(i === sheriffIndex) {
      player.role = "sheriff"
      console.log(`${player.userName} became the sheriff!!`)
    } else {
      player.role = "civilian"
    }
    io.to(player.id).emit(`appointed to ${player.role}`)
  })
}

function spreadVirus(targetRoom, io) {
  const civilianIndexs = []
  targetRoom.players.forEach((player, i) => {
    if(player.role === 'civilian') {
      civilianIndexs.push(i)
    }
  })
  const newZombieIndex =
  civilianIndexs[Math.floor(Math.random() * civilianIndexs.length)]

  targetRoom.players[newZombieIndex].role = "zombie"
  io.in(targetRoom.roomcode).emit("update message", "AAAAAAARGH!!")
  io.to(targetRoom.players[newZombieIndex].id).emit("appointed to zombie")

  targetRoom.status.zombie++
  targetRoom.status.civilian--

  io.in(targetRoom.roomcode).emit('update status', targetRoom.status)
  if (civilianIndexs.length === 1) {
    return true
  } else {
    io.in(targetRoom.roomcode).emit("virus timer", targetRoom.gameSetting.infectionRate)
    return false
  }
}
