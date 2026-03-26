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

// ---- Utilidades de hoja ----

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    var h = {
      Users:    ['id','name','email','googleId','parcela','createdAt'],
      Trips:    ['id','driverId','driverName','driverParcela','date','time','direction','puebloPoint','totalSeats','createdAt'],
      Requests: ['id','tripId','driverId','driverEmail','driverName','requesterId','requesterEmail','requesterName','requesterParcela','status','token','driverComment','createdAt','updatedAt'],
      Payments: ['id','fromUserId','toUserId','amount','createdAt']
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
  var headers = s.getRange(1,1,1,s.getLastColumn()).getValues()[0];
  s.appendRow(headers.map(function(h){ return obj[h] !== undefined ? obj[h] : ''; }));
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
                 requesterName: r.requesterName, requesterParcela: r.requesterParcela };
      })
    });
  });
}

function addTrip(p) {
  var trip = { id: uid(), driverId: p.driverId, driverName: p.driverName, driverParcela: p.driverParcela,
    date: p.date, time: p.time, direction: p.direction, puebloPoint: p.puebloPoint,
    totalSeats: parseInt(p.seats), createdAt: new Date().toISOString() };
  appendRow('Trips', trip);
  return { ok: true, trip: trip };
}

function addTrips(p) {
  var list = JSON.parse(p.trips);
  var created = [];
  list.forEach(function(td){
    var trip = { id: uid(), driverId: td.driverId, driverName: td.driverName, driverParcela: td.driverParcela,
      date: td.date, time: td.time, direction: td.direction, puebloPoint: td.puebloPoint,
      totalSeats: parseInt(td.seats), createdAt: new Date().toISOString() };
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

  // Look up driver email from Users sheet (never trust client for this)
  var users = getRows('Users');
  var driver = users.find(function(u){ return u.id === trip.driverId; });
  var driverEmail = driver ? driver.email : '';

  var token = uid();
  var req = { id: uid(), tripId: p.tripId, driverId: trip.driverId, driverEmail: driverEmail,
    driverName: trip.driverName, requesterId: p.requesterId, requesterEmail: p.requesterEmail,
    requesterName: p.requesterName, requesterParcela: p.requesterParcela,
    status: 'solicitado', token: token, driverComment: '',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  appendRow('Requests', req);

  var gasUrl = ScriptApp.getService().getUrl();
  var route = trip.direction === 'salida' ? 'PBI → ' + trip.puebloPoint : trip.puebloPoint + ' → PBI';
  var approveLink = gasUrl + '?action=respond&token=' + token + '&r=approve';
  var rejectLink  = gasUrl + '?action=respond&token=' + token + '&r=reject';

  try {
    MailApp.sendEmail({
      to: driverEmail,
      subject: '🚗 Solicitud de viaje — ' + req.requesterName,
      body: req.requesterName + ' (Parcela ' + req.requesterParcela + ') solicita tu viaje del ' +
        trip.date + ' a las ' + trip.time + '.\nRuta: ' + route + '\n\n' +
        '✅ APROBAR:\n' + approveLink + '\n\n❌ RECHAZAR:\n' + rejectLink
    });
  } catch(e) {}

  return { ok: true, requestId: req.id };
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

  try {
    MailApp.sendEmail({
      to: req.requesterEmail,
      subject: newStatus === 'aprobado' ? '✅ Viaje aprobado — ' + req.driverName : '❌ Solicitud rechazada — ' + req.driverName,
      body: newStatus === 'aprobado'
        ? req.driverName + ' aprobó tu solicitud para el ' + dateStr + '. ¡Nos vemos en la ruta!'
        : req.driverName + ' rechazó tu solicitud para el ' + dateStr + '.' + (comment ? '\n\nComentario: ' + comment : '')
    });
  } catch(e) {}

  return { ok: true, status: newStatus };
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
    if (r.requesterId === userId) {
      otherId = r.driverId; otherName = r.driverName;
      var d = users.find(function(u){ return u.id === r.driverId; });
      otherParcela = d ? d.parcela : '?';
      delta = -2000; // yo debo
    } else if (r.driverId === userId) {
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
  appendRow('Payments', { id: uid(), fromUserId: p.fromUserId, toUserId: p.toUserId,
    amount: parseInt(p.amount), createdAt: new Date().toISOString() });
  return { ok: true };
}
