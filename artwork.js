// The poster draws uploaded photographs directly, without synthesized faces.
function drawTeamArtwork(ctx, data, images) {
  const width=1080, height=1920;
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
  const box=(x,y,w,h,r,fill,stroke=null)=>{ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();}};
  const text=(value,x,y,size,color,maxWidth,align='left',weight=800)=>{
    ctx.font=`${weight} ${size}px Arial, sans-serif`;
    while(ctx.measureText(value).width>maxWidth && size>14){size--;ctx.font=`${weight} ${size}px Arial, sans-serif`;}
    if(ctx.measureText(value).width>maxWidth){while(value.length>1 && ctx.measureText(value+'…').width>maxWidth)value=value.slice(0,-1);value+='…';}
    ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(value,x,y);
  };
  const background=ctx.createLinearGradient(0,0,width,height);background.addColorStop(0,'#101a31');background.addColorStop(.48,'#070d19');background.addColorStop(1,'#10263f');ctx.fillStyle=background;ctx.fillRect(0,0,width,height);
  for(const [x,color] of [[0,'rgba(205,32,51,.28)'],[1080,'rgba(26,128,220,.25)']]){const glow=ctx.createRadialGradient(x,450,0,x,450,850);glow.addColorStop(0,color);glow.addColorStop(1,'transparent');ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);}
  // Abstract brand stripes; the faces and crest come from original assets.
  ctx.fillStyle='#d62439';ctx.fillRect(0,0,width,10);ctx.fillStyle='#e7c56d';ctx.fillRect(40,1866,1000,3);
  ctx.save();ctx.globalAlpha=.12;ctx.translate(750,0);ctx.rotate(.55);ctx.fillStyle='#6cc5ff';ctx.fillRect(0,-100,70,1050);ctx.restore();
  if(images.logo){const logo=images.logo;const size=250;const scale=Math.min(size/logo.width,size/logo.height);ctx.drawImage(logo,(width-logo.width*scale)/2,62,logo.width*scale,logo.height*scale);}
  text('FC BAGRES D’MUNIQUE',540,354,31,'#e7c56d',990,'center');
  text('É DIA DE',540,463,88,'#ffffff',960,'center',900);
  text('JOGO!',540,591,160,'#ed3048',960,'center',900);
  text(data.teams.length===3?'3 TIMES · 9 JOGOS DE 10 MINUTOS':'TIMES DA PARTIDA',540,686,25,'#bdcde0',960,'center',700);
  const count=data.teams.length, gap=20, margin=40, cardWidth=(1000-gap*(count-1))/count;
  const maxPlayers=Math.max(...data.teams.map(team=>team.players.length));
  const rowHeight=Math.min(106, Math.floor(690/maxPlayers));
  const cardHeight=132+maxPlayers*rowHeight;
  const colors=[{fill:'#102d4a',line:'#61bdff',text:'#fff'},{fill:'#f1f3f6',line:'#e6c76e',text:'#101b2a'},{fill:'#12291f',line:'#83ba75',text:'#fff'}];
  data.teams.forEach((team,index)=>{
    const x=margin+index*(cardWidth+gap), y=744, color=colors[index];
    box(x,y,cardWidth,cardHeight,22,color.fill,color.line);
    text(`EQUIPE ${team.key}`,x+22,y+31,19,index===1?'#586577':'#aec5d9',cardWidth-44);
    text(team.name.toUpperCase(),x+22,y+77,count===3?30:37,color.text,cardWidth-44);
    team.players.forEach((player,i)=>{
      const rowY=y+118+i*rowHeight, avatarSize=Math.min(count===3?66:76,rowHeight-16), avatarX=x+18, avatarY=rowY+(rowHeight-avatarSize)/2;
      box(x+10,rowY+3,cardWidth-20,rowHeight-7,12,index===1?'#ffffff':'rgba(0,0,0,.20)');
      ctx.save();ctx.beginPath();ctx.arc(avatarX+avatarSize/2,avatarY+avatarSize/2,avatarSize/2,0,Math.PI*2);ctx.clip();
      const photo=images.photos.get(player.id);
      if(photo){const crop=Math.min(photo.width,photo.height);ctx.drawImage(photo,(photo.width-crop)/2,(photo.height-crop)/2,crop,crop,avatarX,avatarY,avatarSize,avatarSize);}else{ctx.fillStyle=index===1?'#d9e3ed':'#203e60';ctx.fillRect(avatarX,avatarY,avatarSize,avatarSize);text(player.initials,avatarX+avatarSize/2,avatarY+avatarSize/2,22,color.text,avatarSize-8,'center');}
      ctx.restore();
      const nameX=avatarX+avatarSize+12;
      text(player.name,nameX,rowY+rowHeight/2-(player.fixedGoalkeeper?9:0),count===3?25:30,color.text,x+cardWidth-nameX-18);
      if(player.fixedGoalkeeper)text('GOLEIRO FIXO',nameX,rowY+rowHeight/2+20,15,index===1?'#806211':'#e7c56d',x+cardWidth-nameX-18);
    });
  });
  const date=new Date(`${data.date}T12:00:00`);
  const dateLabel=date.toLocaleDateString('pt-BR');
  const weekday=date.toLocaleDateString('pt-BR',{weekday:'long'}).toUpperCase();
  box(40,1607,1000,126,18,'#111d2f','#334963');
  text(weekday,69,1644,23,'#e7c56d',480);
  text(dateLabel,69,1690,40,'#fff',480);
  text(`${data.start} ÀS ${data.end}`,1009,1670,37,'#fff',450,'right');
  box(40,1751,1000,92,18,'#111d2f','#334963');
  text(data.venue.toUpperCase(),540,1777,30,'#fff',950,'center');
  if(data.address)text(data.address,540,1815,23,'#bdcde0',950,'center',500);
  text('FC BAGRES · DIA DE JOGO',540,1892,19,'#8095ae',960,'center',700);
}
function artworkData() {
  const keys=activeTeamKeys();
  if(availablePlayers().some(player=>!player.team) && !currentRound()) throw new Error('Distribua os confirmados entre os times antes de gerar a arte.');
  const teams=keys.map(key=>({key,name:currentRound()?.names[key] || state[`team${key}Name`],players:entryPlayers(key).map(player=>({id:player.id,name:player.name,initials:initials(player.name),photoUrl:photoUrl(player),fixedGoalkeeper:!!player.fixedGoalkeeper}))}));
  if(teams.some(team=>!team.players.length))throw new Error('Monte todos os times antes de gerar a arte.');
  if(teams.some(team=>team.players.length>12))throw new Error('Este modelo de arte comporta até 12 jogadores por equipe.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(state.matchDate))throw new Error('Escolha a data da partida.');
  const start=$('#artStart').value, end=$('#artEnd').value;
  if(!start || !end || !$('#artVenue').value.trim())throw new Error('Preencha horário e local da partida.');
  return {date:state.matchDate,teams,start,end,venue:$('#artVenue').value.trim(),address:$('#artAddress').value.trim()};
}
function loadArtworkImage(url) {
  return new Promise((resolve,reject)=>{
    const img=new Image();
    const timer=setTimeout(()=>{img.src='';reject(new Error('Não foi possível carregar uma foto. Tente novamente.'));},12000);
    img.onload=()=>{clearTimeout(timer);resolve(img);};
    img.onerror=()=>{clearTimeout(timer);reject(new Error('Não foi possível carregar uma foto. Tente novamente.'));};
    img.src=url;
  });
}
