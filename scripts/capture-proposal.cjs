const { chromium } = require('playwright');
const path = require('path');

async function capture() {
  const browser = await chromium.launch();
  
  // 1. Vista Samsung Galaxy S23 Ultra (móvil)
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileContext.newPage();
  const filePath = 'file:///' + path.resolve(__dirname, '..', 'design-proposals', 'whatsapp-cloud-fix-proposal.html').replace(/\\/g, '/');
  await mobilePage.goto(filePath);
  await mobilePage.waitForTimeout(1000);
  
  // Captura 1: Chat de Luna en móvil (limpio, sin mensajes traslapados de Lauren, compositor bloqueado pidiendo plantilla)
  await mobilePage.screenshot({ path: path.resolve(__dirname, '..', 'propuesta_mobile_luna_chat.png') });
  console.log('Captured propuesta_mobile_luna_chat.png');

  // Captura 2: Búsqueda 101 en móvil (muestra a todos los de 101: Jim, Shalua, Lauren, Mercedes)
  await mobilePage.click('#sidebarPanel button', { timeout: 1000 }).catch(async () => {
    // Si no está visible el sidebar en móvil, invocar showMobileSidebar()
    await mobilePage.evaluate(() => showMobileSidebar());
  });
  await mobilePage.waitForTimeout(300);
  await mobilePage.evaluate(() => simulateSearch('101'));
  await mobilePage.waitForTimeout(500);
  await mobilePage.screenshot({ path: path.resolve(__dirname, '..', 'propuesta_mobile_busqueda_101.png') });
  console.log('Captured propuesta_mobile_busqueda_101.png');

  // 2. Vista Escritorio (Dividida)
  const deskContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1.5,
  });
  const deskPage = await deskContext.newPage();
  await deskPage.goto(filePath);
  await deskPage.waitForTimeout(1000);

  // Seleccionar chat de Jim (para ver nota de voz de WhatsApp auténtica)
  await deskPage.evaluate(() => {
    simulateSearch('');
    selectConversation(1);
  });
  await deskPage.waitForTimeout(500);
  await deskPage.screenshot({ path: path.resolve(__dirname, '..', 'propuesta_desktop_audio_player.png') });
  console.log('Captured propuesta_desktop_audio_player.png');

  // Vista previa de plantilla de saludo (mostrando confirmación antes de enviar)
  await deskPage.evaluate(() => {
    selectConversation(24); // Luna
    toggleTemplateModal();
    previewTemplate('greeting');
  });
  await deskPage.waitForTimeout(500);
  await deskPage.screenshot({ path: path.resolve(__dirname, '..', 'propuesta_desktop_template_confirm.png') });
  console.log('Captured propuesta_desktop_template_confirm.png');

  await browser.close();
  console.log('All screenshots captured successfully!');
}

capture().catch(err => {
  console.error('Error capturing:', err);
  process.exit(1);
});
