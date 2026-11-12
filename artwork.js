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
  const background=ctx.createLinearGradient(0,0,width,height);background.addColorStop(0,'#071a2c');background.addColorStop(.55,'#102b42');background.addColorStop(1,'#06121e');ctx.fillStyle=background;ctx.fillRect(0,0,width,height);
  // Stadium-inspired frame, restrained gold accents and oversized editorial title.
  for(let x=0;x<width;x+=60){ctx.fillStyle='rgba(140,200,235,.025)';ctx.fillRect(x,0,1,height);}
  ctx.save();ctx.globalAlpha=.07;ctx.translate(850,0);ctx.rotate(.45);ctx.fillStyle='#7bc9ed';ctx.fillRect(0,-200,180,2200);ctx.restore();
  box(40,38,1000,4,0,'#e7c56d');
  if(images.logo){const logo=images.logo;const size=180;const scale=Math.min(size/logo.width,size/logo.height);ctx.drawImage(logo,62,78,logo.width*scale,logo.height*scale);}
  text('FC BAGRES',285,139,49,'#ffffff',710);
  text('D’MUNIQUE',287,197,34,'#e7c56d',710);
  text('FUTSAL  /  ESCALAÇÕES OFICIAIS',64,304,23,'#a5c7dc',950);
  text('CONFRONTO',60,400,115,'#ffffff',960,'left',900);
  text('DA SEMANA',64,506,100,'#e7c56d',950,'left',900);
  box(64,580,60,4,0,'#e7c56d');
  text(data.teams.length===3?'3 TIMES · 9 JOGOS DE 10 MINUTOS':'TIMES DA PARTIDA',144,582,23,'#bdcde0',860,'left',700);
  const count=data.teams.length, gap=20, margin=40, cardWidth=(1000-gap*(count-1))/count;
  const maxPlayers=Math.max(...data.teams.map(team=>team.players.length));
  const rowHeight=Math.min(106, Math.floor(790/maxPlayers));
  const cardHeight=132+maxPlayers*rowHeight;
  // Equipes: A vermelha, B branca, C preta.
  const colors=[{fill:'#b30a1a',line:'#ff6b75',text:'#fff',label:'#ffc9cd',avatar:'#7a0612'},{fill:'#f1f3f6',line:'#e6c76e',text:'#101b2a',label:'#586577',avatar:'#d9e3ed'},{fill:'#0d0d0f',line:'#8d8f96',text:'#fff',label:'#b9bcc4',avatar:'#27272c'}];
  data.teams.forEach((team,index)=>{
    const x=margin+index*(cardWidth+gap), y=650, color=colors[index];
    box(x,y,cardWidth,cardHeight,16,color.fill,color.line);
    text(`EQUIPE ${team.key}`,x+22,y+31,19,color.label,cardWidth-44);
    text(team.name.toUpperCase(),x+22,y+77,count===3?30:37,color.text,cardWidth-44);
    team.players.forEach((player,i)=>{
      const rowY=y+118+i*rowHeight, avatarSize=Math.min(count===3?66:76,rowHeight-16), avatarX=x+18, avatarY=rowY+(rowHeight-avatarSize)/2;
      box(x+10,rowY+3,cardWidth-20,rowHeight-7,12,index===1?'#ffffff':'rgba(0,0,0,.20)');
      ctx.save();ctx.beginPath();ctx.arc(avatarX+avatarSize/2,avatarY+avatarSize/2,avatarSize/2,0,Math.PI*2);ctx.clip();
      const photo=images.photos.get(player.id);
      if(photo){const crop=Math.min(photo.width,photo.height);ctx.drawImage(photo,(photo.width-crop)/2,(photo.height-crop)/2,crop,crop,avatarX,avatarY,avatarSize,avatarSize);}else{ctx.fillStyle=color.avatar;ctx.fillRect(avatarX,avatarY,avatarSize,avatarSize);text(player.initials,avatarX+avatarSize/2,avatarY+avatarSize/2,22,color.text,avatarSize-8,'center');}
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
  text('FC BAGRES D’MUNIQUE · FUTEBOL ENTRE AMIGOS',540,1892,19,'#8095ae',960,'center',700);
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
