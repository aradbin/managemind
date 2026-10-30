import sys
from PIL import Image
ims=[Image.open('shots/%s.png'%n) for n in sys.argv[2:]]
W=sum(i.width for i in ims)+20*(len(ims)-1); H=max(i.height for i in ims)
c=Image.new('RGB',(W,H),'white'); x=0
for i in ims: c.paste(i,(x,0)); x+=i.width+20
c.save('shots/%s.png'%sys.argv[1])
