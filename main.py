from typing import List
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI,Request
import time
import random
app = FastAPI()
app.mount("/static",StaticFiles(directory="static"),name="static")
templates=Jinja2Templates(directory="templates")

userListMMsg={}
connectionArray={}
def makeUserListMessage():
    userListMMsg["type"]="userlist"
    userListMMsg["users"]=[]
    for k,v in connectionArray.items():
        userListMMsg["users"].append(v[1])

token=1
def isUsernameUnique(name):
    isUnique=True
    for k,v in connectionArray.items():
        if name==v[1]:
            isUnique=False
            break
    return isUnique

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_json(message)
    async def send_personal_text(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)


    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_json(message)


manager = ConnectionManager()


@app.get("/")
async def get(request:Request):
    res=random.randint(1,100000)
    return templates.TemplateResponse("chat_2.html",{"request":request,"res":res})


@app.websocket("/")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            id = int(time.time())
            # 如果是首次连接就先由manager发送信息
            if not websocket in connectionArray:
                await manager.send_personal_message({"id":id,"type":"id"},websocket)
            #await manager.broadcast(f"Client")
            data = await websocket.receive_json()

            print(data)
            if data["type"]=="username":
                senToClients=False
                if not websocket in connectionArray:
                    msgName=data['name']
                    nameChange=False
                    print(isUsernameUnique(msgName))
                    global token
                    while not isUsernameUnique(msgName):
                        msgName=msgName+str(token)
                        token+=1
                        nameChange=True
                    print(msgName)
                    if nameChange:
                        await manager.send_personal_message({"id":data["id"],"type":"rejectusername","name":msgName},websocket)
                    connectionArray[websocket] = [id, msgName]
                    makeUserListMessage()
                    print("1111")
                    senToClients=False
                    await manager.broadcast(userListMMsg)
            #如果是群消息的话
            elif data["type"]=="message":
                data["name"]=connectionArray[websocket][1]
                for k,v in connectionArray.items():
                   await manager.send_personal_message(data,k)
                pass
            #如果是negociate offer等交换信息
            elif data["target"] != '':
                for k,v in connectionArray.items():
                    if v[1]==data["target"]:
                        await manager.send_personal_message(data,k)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        leave_name=connectionArray[websocket][1]
        connectionArray.pop(websocket)
        makeUserListMessage()
        await manager.broadcast(userListMMsg)
        await manager.broadcast({"type":"leave","name":leave_name})
