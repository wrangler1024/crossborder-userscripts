from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json
P=Path(__file__).parent
S=8
navy='#0B315E';teal='#20AEB3';coral='#FF694A'
shapes=[
(navy,[('M',64,8),('C',79,17,95,20,109,23),('C',113,24,115,27,115,32),('L',115,61),('C',115,87,95,107,67,120),('C',65,121,63,121,61,120),('C',33,107,13,87,13,61),('L',13,32),('C',13,27,15,24,19,23),('C',33,20,49,17,64,8),('Z',)]),
(teal,[('M',64,8),('C',79,17,95,20,109,23),('C',113,24,115,27,115,32),('L',115,39),('C',95,36,78,31,64,24),('C',50,31,33,36,13,39),('L',13,32),('C',13,27,15,24,19,23),('C',33,20,49,17,64,8),('Z',)]),
(coral,[('M',115,49),('L',115,61),('C',115,66,114,71,112,76),('L',101,69),('C',103,62,103,56,103,49),('Z',)])]
def points(commands):
    pts=[];prev=(0,0)
    for c in commands:
        if c[0] in ('M','L'):prev=(c[1],c[2]);pts.append(prev)
        elif c[0]=='C':
            p=prev;a=(c[1],c[2]);b=(c[3],c[4]);end=(c[5],c[6])
            for i in range(1,41):
                t=i/40;u=1-t;pts.append((u**3*p[0]+3*u*u*t*a[0]+3*u*t*t*b[0]+t**3*end[0],u**3*p[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t**3*end[1]))
            prev=end
    return [(round(x*S),round(y*S)) for x,y in pts]
im=Image.new('RGBA',(128*S,128*S));d=ImageDraw.Draw(im)
for color,cmd in shapes:d.polygon(points(cmd),fill=color)
hand=[(62,45),(62,68),(81,68)]
d.line([(x*S,y*S) for x,y in hand],fill='white',width=8*S,joint='curve')
for x,y in hand:d.ellipse(((x-4)*S,(y-4)*S,(x+4)*S,(y+4)*S),fill='white')
paths=''.join('<path fill="'+color+'" d="'+' '.join(c[0]+' '+' '.join(str(v) for v in c[1:]) for c in cmd)+'"/>' for color,cmd in shapes)
svg='<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 128 128"><title>Xynigo 履约护盾 · B1 草稿</title>'+paths+'<path d="M62 45 V68 H81" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
(P/'履约护盾_B1.svg').write_text(svg)
im.save(P/'履约护盾_B1_母版.png')
for n in (16,32,48,128):im.resize((n,n),Image.Resampling.LANCZOS).save(P/f'履约护盾_B1_{n}.png')
# Comparison sheet only; the icon assets above retain transparent backgrounds.
board=Image.new('RGB',(1000,680),'#F2F5F8');bd=ImageDraw.Draw(board)
font='/System/Library/Fonts/STHeiti Medium.ttc'
f=lambda size:ImageFont.truetype(font,size)
bd.text((36,24),'B1 · 履约护盾',fill=navy,font=f(28))
bd.text((36,65),'方向草稿 / 未替换正式图标',fill='#60758B',font=f(16))
board.paste(im.resize((256,256),Image.Resampling.LANCZOS),(42,110),im.resize((256,256),Image.Resampling.LANCZOS))
bd.text((42,382),'轮廓放大 · 检查母题',fill=navy,font=f(16))
base=P.parents[2]
family=[('采购助手',base/'xynigo-dxm-purchase-assistant/icons'),('履约护盾',None),('验证码助手',base/'xynigo-shein-captcha-solver/icons')]
for idx,(label,folder) in enumerate(family):
    x=395+idx*192
    a=Image.open(folder/'icon128.png').convert('RGBA') if folder else Image.open(P/'履约护盾_B1_128.png')
    board.paste(a,(x,143),a)
    bd.text((x,284),label,fill=navy,font=f(16))
bd.text((392,106),'家族并排 · 128px 原尺寸',fill=navy,font=f(17))
for y,bg,fg in [(455,'#FFFFFF',navy),(550,'#202A37','#E5EEF6')]:
    bd.rounded_rectangle((36,y,963,y+76),radius=10,fill=bg)
    bd.text((54,y+22),'16px 原尺寸',fill=fg,font=f(16))
    for idx,(label,folder) in enumerate(family):
        x=253+idx*238
        a=Image.open(folder/'icon16.png').convert('RGBA') if folder else Image.open(P/'履约护盾_B1_16.png')
        board.paste(a,(x,y+30),a);bd.text((x+28,y+22),label,fill=fg,font=f(15))
board.save(P/'履约护盾_B1_评审图.png')
print(json.dumps({n:Image.open(P/f'履约护盾_B1_{n}.png').mode for n in (16,32,48,128)}))
