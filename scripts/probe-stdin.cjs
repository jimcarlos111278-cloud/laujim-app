// Diagnóstico de encoding del pipe stdin. Solo imprime metadatos, nunca el contenido.
let b = [];
process.stdin.on('data', d => b.push(d));
process.stdin.on('end', () => {
  const b0 = Buffer.concat(b);
  console.log(JSON.stringify({
    len: b0.length,
    hasNull: b0.includes(0),
    trailing: JSON.stringify(b0.slice(-4).toString('latin1')),
  }));
});
process.stdin.resume();
