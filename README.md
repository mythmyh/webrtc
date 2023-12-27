1 依赖包python:fastapi,jinja2,uvicorn,websockets


2 uvicorn main:app --host=0.0.0.0 --ssl-keyfile=./server.key --ssl-certfile=./server.crt


3 访问：IP:80000/,点击login in按钮，然后即可选择分享摄像头或者是屏幕，支持三个以上客户端同时登陆
