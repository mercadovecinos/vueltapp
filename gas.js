// ============================================================
// vueltapp — Google Apps Script Backend
// ============================================================
// SETUP:
// 1. Crear nueva hoja en Google Sheets (nombre libre)
// 2. Extensiones → Apps Script → pegar este código
// 3. Ejecutar función "setup" una vez para crear las hojas
// 4. Implementar → Implementación nueva → App web
//    Ejecutar como: Yo | Acceso: Cualquier persona
// 5. Copiar la URL y pegarla en index.html (variable GAS_URL)
// ============================================================

function setup() {
  ['Users','Trips','Requests','Payments'].forEach(function(name) { getSheet(name); });
  Logger.log('Hojas creadas.');
}

// Ejecutar una vez después de desplegar para autorizar todos los scopes (MailApp, Sheets)
function autorizar() {
  SpreadsheetApp.getActiveSpreadsheet();
  Logger.log('Autorización OK. Cuota de mail restante: ' + MailApp.getRemainingDailyQuota());
}

// Diagnóstico: muestra todos los usuarios registrados y sus emails
function diagnosticoUsers() {
  var users = getRows('Users');
  users.forEach(function(u) {
    Logger.log('Parcela ' + u.parcela + ' | ' + u.name + ' | email: [' + u.email + '] | id: ' + u.id);
  });
}

// Diagnóstico: envía mail de prueba a la dirección que pongas aquí
function testMail() {
  var destinatario = 'TU_EMAIL@gmail.com'; // ← cambia por el email del conductor
  try {
    MailApp.sendEmail({
      to: destinatario,
      subject: '🛻 Test vueltapp',
      body: 'Si ves esto, MailApp funciona correctamente desde GAS.'
    });
    Logger.log('Mail enviado OK a ' + destinatario);
  } catch(e) {
    Logger.log('ERROR enviando mail: ' + e.toString());
  }
}

// ---- Utilidades de hoja ----

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    var h = {
      Users:      ['id','name','email','googleId','parcela','createdAt'],
      Trips:      ['id','driverId','driverName','driverParcela','date','time','direction','puebloPoint','totalSeats','createdAt'],
      Requests:   ['id','tripId','driverId','driverEmail','driverName','requesterId','requesterEmail','requesterName','requesterParcela','status','token','driverComment','note','createdAt','updatedAt'],
      Payments:   ['id','fromUserId','toUserId','amount','createdAt'],
      AuthTokens: ['id','email','expiresAt']
    };
    if (h[name]) s.getRange(1,1,1,h[name].length).setValues([h[name]]);
  }
  return s;
}

function formatCell(header, val) {
  if (!(val instanceof Date)) return val;
  // Sheets convierte 'time' y 'date' a Date objects — hay que revertirlos
  if (header === 'time') {
    return ('0'+val.getHours()).slice(-2) + ':' + ('0'+val.getMinutes()).slice(-2);
  }
  if (header === 'date') {
    return val.getFullYear() + '-' + ('0'+(val.getMonth()+1)).slice(-2) + '-' + ('0'+val.getDate()).slice(-2);
  }
  return val.toISOString();
}

function getRows(name) {
  var s = getSheet(name);
  var data = s.getDataRange().getValues();
  if (data.length <= 1) return [];
  var headers = data[0];
  return data.slice(1).map(function(row) {
    var o = {};
    headers.forEach(function(h,i){ o[h] = formatCell(h, row[i]); });
    return o;
  });
}

function appendRow(name, obj) {
  var s = getSheet(name);
  var lastCol = s.getLastColumn();
  var headers = s.getRange(1, 1, 1, lastCol).getValues()[0];
  // Auto-añadir columnas nuevas si no existen (migración automática)
  Object.keys(obj).forEach(function(k) {
    if (headers.indexOf(k) === -1) {
      lastCol++;
      s.getRange(1, lastCol).setValue(k);
      headers.push(k);
    }
  });
  s.appendRow(headers.map(function(h){ return obj[h] !== undefined ? obj[h] : ''; }));
}

function deleteRow(name, idVal) {
  var s = getSheet(name);
  var data = s.getDataRange().getValues();
  var idCol = data[0].indexOf('id');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(idVal)) {
      s.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function updateRow(name, idVal, updates) {
  var s = getSheet(name);
  var data = s.getDataRange().getValues();
  var headers = data[0];
  var idCol = headers.indexOf('id');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(idVal)) {
      Object.keys(updates).forEach(function(k) {
        var col = headers.indexOf(k);
        if (col >= 0) s.getRange(i+1, col+1).setValue(updates[k]);
      });
      return true;
    }
  }
  return false;
}

function uid() { return Utilities.getUuid(); }

// ---- Router ----

function doGet(e) {
  var p = e.parameter;
  var action = p.action;
  var result;
  try {
    if (action === 'respond')         return handleEmailRespond(p);
    else if (action === 'googleAuth')  result = googleAuth(p);
    else if (action === 'getTrips')   result = getTrips(p);
    else if (action === 'addTrip')    result = addTrip(p);
    else if (action === 'addTrips')   result = addTrips(p);
    else if (action === 'requestTrip')   result = requestTrip(p);
    else if (action === 'respondRequest') result = respondRequest(p);
    else if (action === 'getMyTrips')    result = getMyTrips(p);
    else if (action === 'getMyRequests') result = getMyRequests(p);
    else if (action === 'getBalance')    result = getBalance(p);
    else if (action === 'addPayment')    result = addPayment(p);
    else if (action === 'cancelTrip')      result = cancelTrip(p);
    else if (action === 'cancelRequest')   result = cancelRequest(p);
    else if (action === 'requestMagicLink') result = requestMagicLink(p);
    else if (action === 'verifyMagicToken') result = verifyMagicToken(p);
    else if (action === 'createEmailUser')  result = createEmailUser(p);
    else if (action === 'ping')          result = pingAction(p);
    else result = { error: 'Acción desconocida' };
  } catch(err) {
    result = { error: err.toString() };
  }
  var json = JSON.stringify(result);
  var cb = p.callback;
  if (cb) {
    return ContentService.createTextOutput(cb+'('+json+')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ---- Auth ----

function googleAuth(p) {
  if (!p.googleId || !p.email) return { error: 'Datos de Google incompletos' };
  var users = getRows('Users');
  // Buscar por googleId o email
  var u = users.find(function(u){ return u.googleId === p.googleId || u.email === p.email; });
  if (u) {
    // Actualizar googleId si no lo tenía (migración)
    if (!u.googleId) updateRow('Users', u.id, { googleId: p.googleId });
    return { ok: true, user: { id: u.id, name: u.name, email: u.email, parcela: u.parcela } };
  }
  // Usuario nuevo — necesita parcela
  if (!p.parcela) return { needsParcela: true };
  var newUser = { id: uid(), name: p.name, email: p.email, googleId: p.googleId, parcela: p.parcela, createdAt: new Date().toISOString() };
  appendRow('Users', newUser);
  return { ok: true, user: { id: newUser.id, name: newUser.name, email: newUser.email, parcela: newUser.parcela } };
}

// ---- Viajes ----

function getTrips(p) {
  var trips = getRows('Trips');
  var requests = getRows('Requests');
  var filtered = trips.filter(function(t){ return t.date >= p.start && t.date <= p.end; });
  return filtered.map(function(t){
    var reqs = requests.filter(function(r){ return r.tripId === t.id; });
    var approved = reqs.filter(function(r){ return r.status === 'aprobado'; }).length;
    return Object.assign({}, t, {
      availableSeats: parseInt(t.totalSeats) - approved,
      requests: reqs.map(function(r){
        return { id: r.id, status: r.status, requesterId: r.requesterId,
                 requesterName: r.requesterName, requesterParcela: r.requesterParcela, note: r.note || '' };
      })
    });
  });
}

function addTrip(p) {
  var trip = { id: uid(), driverId: p.driverId, driverName: p.driverName, driverParcela: p.driverParcela,
    date: p.date, time: p.time, direction: p.direction, puebloPoint: p.puebloPoint,
    totalSeats: parseInt(p.seats), note: p.note || '', createdAt: new Date().toISOString() };
  appendRow('Trips', trip);
  return { ok: true, trip: trip };
}

function addTrips(p) {
  var list = JSON.parse(p.trips);
  var created = [];
  list.forEach(function(td){
    var trip = { id: uid(), driverId: td.driverId, driverName: td.driverName, driverParcela: td.driverParcela,
      date: td.date, time: td.time, direction: td.direction, puebloPoint: td.puebloPoint,
      totalSeats: parseInt(td.seats), note: td.note || '', createdAt: new Date().toISOString() };
    appendRow('Trips', trip);
    created.push(trip);
  });
  return { ok: true, trips: created };
}

// ---- Solicitudes ----

function requestTrip(p) {
  var trips = getRows('Trips');
  var trip = trips.find(function(t){ return t.id === p.tripId; });
  if (!trip) return { error: 'Viaje no encontrado' };

  var requests = getRows('Requests');
  var dup = requests.find(function(r){
    return r.tripId === p.tripId && r.requesterId === p.requesterId && r.status !== 'rechazado';
  });
  if (dup) return { error: 'Ya solicitaste este viaje' };

  var approved = requests.filter(function(r){ return r.tripId === p.tripId && r.status === 'aprobado'; }).length;
  if (approved >= parseInt(trip.totalSeats)) return { error: 'No hay cupos disponibles' };

  // Buscar datos reales del conductor y del solicitante desde Users (no confiar en el cliente)
  var users = getRows('Users');
  var driver = users.find(function(u){ return u.id === trip.driverId; });
  if (!driver) return { error: 'No se encontró el conductor. Pídele que verifique su cuenta.' };
  var driverEmail = driver.email;

  var requester = users.find(function(u){ return u.id === p.requesterId; });
  if (!requester) return { error: 'Usuario no encontrado. Cerrá sesión y volvé a entrar.' };

  var token = uid();
  var req = { id: uid(), tripId: p.tripId, driverId: trip.driverId, driverEmail: driverEmail,
    driverName: trip.driverName, requesterId: requester.id, requesterEmail: requester.email,
    requesterName: requester.name, requesterParcela: requester.parcela,
    status: 'solicitado', token: token, driverComment: '', note: p.note || '',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

  // Guardar solo después de validar todo
  appendRow('Requests', req);

  var gasUrl = ScriptApp.getService().getUrl();
  var route = trip.direction === 'salida' ? 'PBI → ' + trip.puebloPoint : trip.puebloPoint + ' → PBI';
  var approveLink = gasUrl + '?action=respond&token=' + token + '&r=approve';
  var rejectLink  = gasUrl + '?action=respond&token=' + token + '&r=reject';

  var mailError = null;
  try {
    MailApp.sendEmail({
      to: driverEmail,
      subject: '🛻 Solicitud de viaje — ' + req.requesterName,
      body: req.requesterName + ' (Parcela ' + req.requesterParcela + ') quiere unirse a tu viaje del ' +
        trip.date + ' a las ' + trip.time + '.\nRuta: ' + route +
        (req.note ? '\n\nNota del pasajero: "' + req.note + '"' : '') +
        '\n\nResponde desde los botones o directamente en vueltapp (el pasajero recibirá un mail con tu respuesta).' +
        '\n\n✅ APROBAR:\n' + approveLink + '\n\n❌ RECHAZAR:\n' + rejectLink
    });
  } catch(e) { mailError = e.toString(); }

  return { ok: true, requestId: req.id, mailError: mailError };
}

function respondRequest(p) {
  var requests = getRows('Requests');
  var req = p.token
    ? requests.find(function(r){ return r.token === p.token; })
    : requests.find(function(r){ return r.id === p.requestId; });
  if (!req) return { error: 'Solicitud no encontrada' };
  if (req.status !== 'solicitado') return { error: 'Esta solicitud ya fue respondida' };

  var newStatus = (p.r === 'approve' || p.r === 'aprobado') ? 'aprobado' : 'rechazado';
  var comment = p.comment || '';
  updateRow('Requests', req.id, { status: newStatus, driverComment: comment, updatedAt: new Date().toISOString() });

  var trips = getRows('Trips');
  var trip = trips.find(function(t){ return t.id === req.tripId; });
  var dateStr = trip ? trip.date + ' a las ' + trip.time : '';

  var mailError = null;
  try {
    MailApp.sendEmail({
      to: req.requesterEmail,
      subject: newStatus === 'aprobado' ? '✅ Viaje aprobado — ' + req.driverName : '❌ Solicitud rechazada — ' + req.driverName,
      body: newStatus === 'aprobado'
        ? req.driverName + ' aprobó tu solicitud para el ' + dateStr + '. ¡Nos vemos en la ruta! Puedes ver el detalle en vueltapp.'
        : req.driverName + ' rechazó tu solicitud para el ' + dateStr + '.' + (comment ? '\n\nComentario: ' + comment : '')
    });
  } catch(e) { mailError = e.toString(); }

  return { ok: true, status: newStatus, mailError: mailError };
}

function handleEmailRespond(p) {
  var token = p.token;
  var gasUrl = ScriptApp.getService().getUrl();

  if (p.r === 'reject' && p.comment === undefined) {
    var html = '<html><meta name="viewport" content="width=device-width"><body style="font-family:-apple-system,sans-serif;max-width:420px;margin:40px auto;padding:20px">' +
      '<h2 style="color:#2c5530">❌ Rechazar solicitud</h2>' +
      '<p style="color:#555;margin-bottom:16px">Agrega un comentario opcional para el pasajero:</p>' +
      '<form method="GET" action="' + gasUrl + '">' +
      '<input type="hidden" name="action" value="respond">' +
      '<input type="hidden" name="token" value="' + token + '">' +
      '<input type="hidden" name="r" value="reject">' +
      '<textarea name="comment" rows="3" placeholder="Ej: ya tengo el auto lleno..." style="width:100%;padding:12px;border:2px solid #ddd;border-radius:8px;font-size:1rem;margin-bottom:12px;box-sizing:border-box"></textarea>' +
      '<button type="submit" style="background:#e63946;color:white;border:none;padding:12px 24px;border-radius:8px;font-size:1rem;cursor:pointer;width:100%">Confirmar rechazo</button>' +
      '</form></body></html>';
    return HtmlService.createHtmlOutput(html);
  }

  var result = respondRequest(p);
  var icon = result.error ? '⚠️' : (p.r === 'approve' ? '✅' : '❌');
  var msg  = result.error ? result.error : (p.r === 'approve' ? '¡Solicitud aprobada! Se notificó al pasajero.' : 'Solicitud rechazada. Se notificó al pasajero.');
  var html = '<html><meta name="viewport" content="width=device-width"><body style="font-family:-apple-system,sans-serif;max-width:420px;margin:0 auto;padding:60px 20px;text-align:center">' +
    '<div style="font-size:4rem;margin-bottom:16px">' + icon + '</div>' +
    '<h2 style="color:#2c5530;margin-bottom:8px">' + msg + '</h2>' +
    '<p style="color:#888">Puedes cerrar esta pestaña.</p>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html);
}

// ---- Mis datos ----

function getMyTrips(p) {
  var trips = getRows('Trips');
  var requests = getRows('Requests');
  return trips
    .filter(function(t){ return t.driverId === p.userId; })
    .map(function(t){
      var reqs = requests.filter(function(r){ return r.tripId === t.id; });
      var approved = reqs.filter(function(r){ return r.status === 'aprobado'; }).length;
      return Object.assign({}, t, { availableSeats: parseInt(t.totalSeats) - approved, requests: reqs });
    });
}

function getMyRequests(p) {
  var requests = getRows('Requests');
  var trips    = getRows('Trips');
  return requests
    .filter(function(r){ return r.requesterId === p.userId; })
    .map(function(r){
      return Object.assign({}, r, { trip: trips.find(function(t){ return t.id === r.tripId; }) || null });
    });
}

// ---- Balance ----

function getBalance(p) {
  var userId   = p.userId;
  var requests = getRows('Requests');
  var trips    = getRows('Trips');
  var users    = getRows('Users');
  var payments = getRows('Payments');
  var today    = new Date().toISOString().split('T')[0];
  var bal = {}; // { otherId: { name, parcela, amount } } +: me deben, -: debo

  requests.forEach(function(r){
    if (r.status !== 'aprobado') return;
    var trip = trips.find(function(t){ return t.id === r.tripId; });
    if (!trip || trip.date > today) return;
    var otherId, otherName, otherParcela, delta;
    // Fallback: si driverId está vacío en el request, buscarlo desde el viaje
    var driverId = r.driverId || (trip ? trip.driverId : '');
    if (r.requesterId === userId) {
      otherId = driverId; otherName = r.driverName;
      var d = users.find(function(u){ return u.id === driverId; });
      otherParcela = d ? d.parcela : '?';
      delta = -2000; // yo debo
    } else if (driverId === userId) {
      otherId = r.requesterId; otherName = r.requesterName;
      var d = users.find(function(u){ return u.id === r.requesterId; });
      otherParcela = d ? d.parcela : '?';
      delta = 2000; // me deben
    } else return;
    if (!bal[otherId]) bal[otherId] = { name: otherName, parcela: otherParcela, amount: 0 };
    bal[otherId].amount += delta;
  });

  payments.forEach(function(pay){
    if (pay.fromUserId !== userId && pay.toUserId !== userId) return;
    var otherId = pay.fromUserId === userId ? pay.toUserId : pay.fromUserId;
    if (!bal[otherId]) return;
    bal[otherId].amount += pay.fromUserId === userId ? parseInt(pay.amount) : -parseInt(pay.amount);
  });

  var result = [];
  Object.keys(bal).forEach(function(id){
    if (bal[id].amount !== 0)
      result.push({ userId: id, name: bal[id].name, parcela: bal[id].parcela, amount: bal[id].amount });
  });
  return { ok: true, balances: result };
}

function addPayment(p) {
  // Solo el acreedor (toUserId) puede registrar el pago
  if (!p.callerId || p.callerId !== p.toUserId) return { error: 'Solo quien recibe el pago puede marcarlo como pagado' };
  var amount = parseInt(p.amount);
  if (!amount || amount <= 0) return { error: 'Monto inválido' };
  appendRow('Payments', { id: uid(), fromUserId: p.fromUserId, toUserId: p.toUserId,
    amount: amount, createdAt: new Date().toISOString() });
  return { ok: true };
}

function cancelTrip(p) {
  if (!p.callerId || !p.tripId) return { error: 'Datos incompletos' };
  var trips = getRows('Trips');
  var trip = trips.find(function(t){ return t.id === p.tripId; });
  if (!trip) return { error: 'Viaje no encontrado' };
  if (trip.driverId !== p.callerId) return { error: 'Solo el conductor puede cancelar este viaje' };
  var today = new Date().toISOString().split('T')[0];
  if (trip.date < today) return { error: 'No se puede cancelar un viaje pasado' };

  // Cancelar y notificar a todos los pasajeros con solicitud activa
  var requests = getRows('Requests');
  var active = requests.filter(function(r){
    return r.tripId === p.tripId && (r.status === 'solicitado' || r.status === 'aprobado');
  });
  active.forEach(function(r) {
    updateRow('Requests', r.id, { status: 'cancelado', updatedAt: new Date().toISOString() });
    try {
      MailApp.sendEmail({
        to: r.requesterEmail,
        subject: '❌ Viaje cancelado — ' + trip.driverName,
        body: trip.driverName + ' canceló el viaje del ' + trip.date + ' a las ' + trip.time + '.\nRuta: ' +
          (trip.direction === 'salida' ? 'PBI → ' + trip.puebloPoint : trip.puebloPoint + ' → PBI') +
          '\n\nTu solicitud quedó sin efecto. Puedes buscar otro viaje en vueltapp.'
      });
    } catch(e) {}
  });

  deleteRow('Trips', p.tripId);
  return { ok: true };
}

function cancelRequest(p) {
  if (!p.callerId || !p.requestId) return { error: 'Datos incompletos' };
  var requests = getRows('Requests');
  var req = requests.find(function(r){ return r.id === p.requestId; });
  if (!req) return { error: 'Solicitud no encontrada' };
  if (req.requesterId !== p.callerId) return { error: 'Solo el pasajero puede cancelar su solicitud' };
  if (req.status === 'rechazado' || req.status === 'cancelado') return { error: 'Esta solicitud ya no está activa' };

  var trips = getRows('Trips');
  var trip = trips.find(function(t){ return t.id === req.tripId; });
  var today = new Date().toISOString().split('T')[0];
  if (trip && trip.date < today) return { error: 'No se puede cancelar un viaje pasado' };

  updateRow('Requests', req.id, { status: 'cancelado', updatedAt: new Date().toISOString() });

  // Notificar al conductor solo si estaba aprobado
  if (req.status === 'aprobado' && trip) {
    var users = getRows('Users');
    var driver = users.find(function(u){ return u.id === req.driverId; });
    if (driver && driver.email) {
      try {
        MailApp.sendEmail({
          to: driver.email,
          subject: '⚠️ Pasajero canceló su cupo — ' + req.requesterName,
          body: req.requesterName + ' canceló su cupo en tu viaje del ' + trip.date + ' a las ' + trip.time + '.\n' +
            'Quedó un cupo libre. Puedes ver el detalle en vueltapp.'
        });
      } catch(e) {}
    }
  }

  return { ok: true };
}

function requestMagicLink(p) {
  if (!p.email) return { error: 'Ingresa tu email' };
  var email = p.email.trim().toLowerCase();
  // Limpiar tokens viejos de este email
  var s = getSheet('AuthTokens');
  var data = s.getDataRange().getValues();
  var headers = data[0];
  var emailCol = headers.indexOf('email');
  var expiresCol = headers.indexOf('expiresAt');
  var now = new Date();
  for (var i = data.length - 1; i >= 1; i--) {
    if (data[i][emailCol] === email || new Date(data[i][expiresCol]) < now) {
      s.deleteRow(i + 1);
    }
  }
  // Crear token nuevo (expira en 15 min)
  var token = uid();
  var expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  appendRow('AuthTokens', { id: token, email: email, expiresAt: expiresAt });

  var appUrl = 'https://mercadovecinos.github.io/vueltapp/?token=' + token;
  try {
    MailApp.sendEmail({
      to: email,
      subject: '🛻 Tu link de acceso a vueltapp',
      body: 'Haz click en el link para entrar a vueltapp (válido por 15 minutos):\n\n' + appUrl +
        '\n\nSi no pediste esto, ignora este mensaje.'
    });
  } catch(e) {
    return { error: 'No se pudo enviar el email: ' + e.toString() };
  }
  return { ok: true };
}

function verifyMagicToken(p) {
  if (!p.token) return { error: 'Token inválido' };
  var tokens = getRows('AuthTokens');
  var entry = tokens.find(function(t){ return (t.id || t.token) === p.token; });
  if (!entry) return { error: 'Link inválido o ya fue usado' };
  if (new Date(entry.expiresAt) < new Date()) return { error: 'El link expiró — solicita uno nuevo' };

  // Eliminar token (uso único) — busca por columna 'id'
  deleteRow('AuthTokens', entry.id || entry.token);

  var email = entry.email;
  var users = getRows('Users');
  var user = users.find(function(u){ return u.email === email; });
  if (user) {
    return { ok: true, user: { id: user.id, name: user.name, email: user.email, parcela: user.parcela } };
  }
  // Usuario nuevo — necesita nombre y parcela
  if (p.name && p.parcela) {
    var newUser = { id: uid(), name: p.name.trim(), email: email, googleId: '', parcela: p.parcela, createdAt: new Date().toISOString() };
    appendRow('Users', newUser);
    return { ok: true, user: { id: newUser.id, name: newUser.name, email: newUser.email, parcela: newUser.parcela } };
  }
  return { needsProfile: true, email: email };
}

function createEmailUser(p) {
  if (!p.email || !p.name || !p.parcela) return { error: 'Datos incompletos' };
  var users = getRows('Users');
  // Verificar que no exista ya (por si acaso)
  var existing = users.find(function(u){ return u.email === p.email.trim().toLowerCase(); });
  if (existing) return { ok: true, user: { id: existing.id, name: existing.name, email: existing.email, parcela: existing.parcela } };
  var newUser = { id: uid(), name: p.name.trim(), email: p.email.trim().toLowerCase(), googleId: '', parcela: p.parcela, createdAt: new Date().toISOString() };
  appendRow('Users', newUser);
  return { ok: true, user: { id: newUser.id, name: newUser.name, email: newUser.email, parcela: newUser.parcela } };
}

// ── Exportar datos como SQL para migrar a Supabase ──
// Ejecutar desde el editor de GAS: Run → exportToSupabase
// Ver resultado en: Ver → Registros de ejecución
function exportToSupabase() {
  function esc(v) { return String(v || '').replace(/'/g, "''"); }
  var sql = '-- vueltapp migration SQL\n-- Pegar en Supabase SQL Editor DESPUÉS de correr migration_prep.sql\n\n';

  // Users
  sql += '-- USERS\n';
  getRows('Users').forEach(function(u) {
    sql += "INSERT INTO public.users (id, name, parcela, email) VALUES ('" +
      esc(u.id) + "','" + esc(u.name) + "','" + esc(u.parcela) + "','" + esc((u.email||'').toLowerCase()) +
      "') ON CONFLICT (id) DO NOTHING;\n";
  });

  // Trips
  sql += '\n-- TRIPS\n';
  getRows('Trips').forEach(function(t) {
    sql += "INSERT INTO public.trips (id,driver_id,driver_name,driver_parcela,date,time,direction,pueblo_point,total_seats,note,created_at) VALUES ('" +
      esc(t.id) + "','" + esc(t.driverId) + "','" + esc(t.driverName) + "','" + esc(t.driverParcela) + "','" +
      esc(t.date) + "','" + esc(t.time) + "','" + esc(t.direction) + "','" + esc(t.puebloPoint) + "'," +
      parseInt(t.totalSeats||1) + ",'" + esc(t.note) + "','" + esc(t.createdAt) +
      "') ON CONFLICT (id) DO NOTHING;\n";
  });

  // Requests
  sql += '\n-- REQUESTS\n';
  getRows('Requests').forEach(function(r) {
    sql += "INSERT INTO public.requests (id,trip_id,driver_id,driver_name,requester_id,requester_name,requester_parcela,status,token,driver_comment,note,created_at,updated_at) VALUES ('" +
      esc(r.id) + "','" + esc(r.tripId) + "','" + esc(r.driverId) + "','" + esc(r.driverName) + "','" +
      esc(r.requesterId) + "','" + esc(r.requesterName) + "','" + esc(r.requesterParcela) + "','" +
      esc(r.status) + "','" + esc(r.token||r.id) + "','" + esc(r.driverComment) + "','" + esc(r.note) + "','" +
      esc(r.createdAt) + "','" + esc(r.updatedAt||r.createdAt) +
      "') ON CONFLICT (id) DO NOTHING;\n";
  });

  // Payments
  sql += '\n-- PAYMENTS\n';
  getRows('Payments').forEach(function(p) {
    sql += "INSERT INTO public.payments (id,from_user_id,to_user_id,amount,created_at) VALUES ('" +
      esc(p.id) + "','" + esc(p.fromUserId) + "','" + esc(p.toUserId) + "'," +
      parseInt(p.amount||0) + ",'" + esc(p.createdAt) +
      "') ON CONFLICT (id) DO NOTHING;\n";
  });

  // Escribir a Google Doc (el log de GAS trunca textos largos)
  var doc = DocumentApp.create('vueltapp_migration_' + new Date().toISOString().slice(0,10));
  doc.getBody().setText(sql);
  Logger.log('✅ SQL escrito en Google Doc: ' + doc.getUrl());
  Logger.log('Abre el link, selecciona todo (Cmd+A), copia y pega en Supabase SQL Editor.');
}

function pingAction(p) {
  var v = { version: 3, ts: new Date().toISOString() };
  if (!p.to) return v;
  // Test mail desde doGet
  var err = null;
  try { MailApp.sendEmail({ to: p.to, subject: 'vueltapp ping doGet ' + new Date().toISOString(), body: 'Mail enviado desde doGet. Versión 3.' }); }
  catch(e) { err = e.toString(); }
  return Object.assign(v, { sentTo: p.to, mailError: err });
}
