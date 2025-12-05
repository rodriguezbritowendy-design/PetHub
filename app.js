/* ============================================================
   app.js - Versión mejorada
   ============================================================ */

/* ---------------- CONFIG ---------------- */
const BASE64_OW_KEY = "MTRlMDhjNGY0ZjcwZWVhOWQ1YjY3YTIxMmE0OWNlODM=";
const OPENWEATHER_KEY = atob(BASE64_OW_KEY);
const EXCHANGE_BASE = "https://api.exchangerate-api.com/v4/latest";
const RESTCOUNTRIES = "https://restcountries.com/v3.1";
const MYMEMORY = "https://api.mymemory.translated.net/get";
const CACHE_TTL_MS = 1000 * 60 * 5;

/* ---------------- UTILIDADES ---------------- */
function $id(id){ return document.getElementById(id); }
function setHTML(id, html){ const el = $id(id); if(el) el.innerHTML = html; }
function showIf(id, cond){ const el=$id(id); if(el) el.style.display = cond? "block":"none"; }
function spinnerHTML(text="Cargando..."){ return `<div class="spinner">${text}</div>`; }

/* ---------------- CACHE ---------------- */
function cacheSet(key, value){
    const obj = { ts: Date.now(), v: value };
    try{ sessionStorage.setItem(key, JSON.stringify(obj)); }catch(e){}
}
function cacheGet(key){
    try{
        const raw = sessionStorage.getItem(key);
        if(!raw) return null;
        const obj = JSON.parse(raw);
        if(Date.now() - obj.ts > CACHE_TTL_MS) { sessionStorage.removeItem(key); return null; }
        return obj.v;
    } catch(e){ return null; }
}

/* ---------------- HISTORIAL ---------------- */
function pushHistory(kind, value){
    try{
        const raw = localStorage.getItem("ws_history") || "[]";
        const arr = JSON.parse(raw);
        arr.unshift({ kind, value, t: new Date().toISOString() });
        localStorage.setItem("ws_history", JSON.stringify(arr.slice(0,50)));
    } catch(e){}
}
function getHistory(){ try{ return JSON.parse(localStorage.getItem("ws_history")||"[]"); }catch(e){ return []; } }

/* ======================================================
   MAPA (Leaflet + MapTiler)
====================================================== */

var map = L.map('map').setView([19.4326, -99.1332], 12);

L.tileLayer(
    "https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=BIceIX5ZLuciUroIwcrU",
    {
        maxZoom: 20,
        tileSize: 512,
        zoomOffset: -1,
        attribution: '&copy; MapTiler &copy; OpenStreetMap'
    }
).addTo(map);

let marcadorCiudad = null;
let marcadorPais = null;

/* ---------------- FETCH SAFE ---------------- */
function safeFetchJson(url){ 
    return fetch(url).then(r => { 
        if(!r.ok) throw new Error(`${r.status} ${r.statusText}`); 
        return r.json(); 
    });
}

/* ======================================================
   CLIMA
====================================================== */

async function fetchWeatherByCity(city){
    const key = `weather_city_${city.toLowerCase()}`;
    const cached = cacheGet(key);
    if(cached) return cached;

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${OPENWEATHER_KEY}&units=metric&lang=es`;
    const data = await safeFetchJson(url);
    cacheSet(key, data);
    return data;
}

async function fetchForecastByCoords(lat, lon){
    const key = `forecast_${lat}_${lon}`;
    const cached = cacheGet(key);
    if(cached) return cached;

    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_KEY}&units=metric&lang=es`;
    const data = await safeFetchJson(url);
    cacheSet(key, data);
    return data;
}

function summarizeForecast(forecast){
    const daily = {};
    for(const item of forecast.list){
        const day = item.dt_txt.slice(0,10);
        if(!daily[day]) daily[day] = { temps: [], weather: {} };
        daily[day].temps.push(item.main.temp);
        const w = item.weather[0].description;
        daily[day].weather[w] = (daily[day].weather[w]||0)+1;
    }
    const result = [];
    for(const day of Object.keys(daily).slice(0,5)){
        const d = daily[day];
        const avg = d.temps.reduce((a,b)=>a+b,0)/d.temps.length;
        const mainWeather = Object.entries(d.weather).sort((a,b)=>b[1]-a[1])[0][0];
        result.push({ day, temp: avg.toFixed(1), desc: mainWeather });
    }
    return result;
}

async function ui_consultarClimaDebounced(city){
    setHTML("resultadoClima", spinnerHTML("Consultando clima..."));

    try{
        const weather = await fetchWeatherByCity(city);
        const { coord, sys } = weather;

        setHTML("resultadoClima", `
            <strong>${weather.name}, ${sys.country}</strong><br>
            🌡 ${weather.main.temp} °C (sensación ${weather.main.feels_like}°C)<br>
            ☁ ${weather.weather[0].description}<br>
            💧 ${weather.main.humidity}% - 🌬 ${weather.wind.speed} m/s
        `);

        const lat = coord.lat, lon = coord.lon;
        map.setView([lat, lon], 12);

        if(marcadorCiudad) map.removeLayer(marcadorCiudad);
        marcadorCiudad = L.marker([lat, lon]).addTo(map).bindPopup(`${weather.name}`).openPopup();

        try{
            const countryData = await safeFetchJson(`${RESTCOUNTRIES}/alpha/${sys.country}`);
            const c = countryData[0];
            if(c && c.currencies){
                const code = Object.keys(c.currencies)[0];
                const info = c.currencies[code];
                setHTML("monedaCiudad", `<strong>Moneda:</strong> ${info.name} (${code}) ${info.symbol||""}`);
                window.monedaActual = code;
            }
        }catch(e){
            window.monedaActual = "MXN";
        }

        try{
            const forecast = await fetchForecastByCoords(lat, lon);
            const daily = summarizeForecast(forecast);

            let html = `<h4>Pronóstico (5 días):</h4><div class="forecast-row">`;
            for(const d of daily){
                html += `<div class="forecast-card"><div class="f-day">${d.day}</div><div class="f-temp">${d.temp} °C</div><div class="f-desc">${d.desc}</div></div>`;
            }
            html += `</div>`;

            setHTML("resultadoClima", $id("resultadoClima").innerHTML + html);
        }catch(e){}

        pushHistory("clima", city);

    }catch(err){
        setHTML("resultadoClima", `Error al consultar el clima: ${err.message}`);
    }
}

function debounce(fn, ms){
    let t;
    return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
}

const uiBuscarClima = debounce(()=> {
    const city = ($id("ciudad").value||"").trim();
    if(!city){ setHTML("resultadoClima","Escribe una ciudad."); return; }
    ui_consultarClimaDebounced(city);
}, 500);

/* ======================================================
   PAÍSES
====================================================== */

async function ui_buscarPais(){
    const pais = ($id("pais").value||"").trim();
    if(!pais){ setHTML("infoPais","Ingresa un país."); return; }

    setHTML("infoPais", spinnerHTML("Buscando país..."));

    try{
        const data = await safeFetchJson(`${RESTCOUNTRIES}/name/${encodeURIComponent(pais)}`);
        const p = data[0];

        const lat = p.latlng[0], lon = p.latlng[1];
        map.setView([lat, lon], 5);

        if(marcadorPais) map.removeLayer(marcadorPais);
        marcadorPais = L.marker([lat, lon]).addTo(map).bindPopup(p.name.common).openPopup();

        setHTML("infoPais", `
            <strong>${p.name.common}</strong><br>
            Capital: ${p.capital?.[0] || "N/A"}<br>
            Región: ${p.region}<br>
            Población: ${p.population.toLocaleString()}<br>
            Idioma: ${Object.values(p.languages || {})[0] || "N/A"}<br>
            <img src="${p.flags.png}" width="120" style="margin-top:8px;">
        `);

        if(p.currencies){
            const code = Object.keys(p.currencies)[0];
            const info = p.currencies[code];
            setHTML("monedaPais", `<strong>Moneda:</strong> ${info.name} (${code}) ${info.symbol||""}`);
            window.monedaActual = code;
        }

        pushHistory("pais", pais);

    }catch(err){
        setHTML("infoPais", `Error al consultar país: ${err.message}`);
    }
}

/* ======================================================
   CONVERTIDOR
====================================================== */

async function ui_convertir(){
    const monto = parseFloat($id("monto").value);
    const salida = $id("resultadoMoneda");

    if(isNaN(monto) || monto <= 0){
        salida.textContent = "Ingresa una cantidad válida.";
        return;
    }

    const origen = window.monedaActual || "MXN";
    const destino = "USD";

    salida.innerHTML = spinnerHTML(`Consultando tasas (${origen} → ${destino})...`);

    try{
        const key = `exchange_${origen}`;
        let data = cacheGet(key);

        if(!data){
            data = await safeFetchJson(`${EXCHANGE_BASE}/${origen}`);
            cacheSet(key, data);
        }

        const tasa = data.rates[destino];
        const converted = (monto * tasa).toFixed(2);

        setHTML("resultadoMoneda", `<strong>${monto} ${origen} = ${converted} ${destino}</strong><br><small>Tasa: ${tasa}</small>`);

        pushHistory("convertir", `${monto} ${origen} -> ${destino}`);

    }catch(err){
        setHTML("resultadoMoneda", `Error al convertir: ${err.message}`);
    }
}

/* ======================================================
   TRADUCTOR
====================================================== */

async function ui_traducir(){
    const texto = ($id("textoTraducir").value||"").trim();
    const from = ($id("langFrom")?.value) || "es";
    const to = ($id("langTo")?.value) || "en";

    const out = $id("resultadoTraduccion");

    if(!texto){ out.textContent = "Escribe algo para traducir."; return; }

    out.innerHTML = spinnerHTML("Traduciendo...");

    try{
        const url = `${MYMEMORY}?q=${encodeURIComponent(texto)}&langpair=${from}|${to}`;
        const data = await safeFetchJson(url);

        const translated = data.responseData?.translatedText || "";

        setHTML("resultadoTraduccion", `<strong>${from} → ${to}:</strong> ${translated}`);

        pushHistory("traducir", `${from}->${to}: ${texto}`);

    }catch(err){
        out.textContent = "Error en traducción.";
    }
}

/* ======================================================
   MINI API
====================================================== */

async function obtenerClimaComoServicio(ciudad){
    try{
        const w = await fetchWeatherByCity(ciudad);
        if(!w || !w.name) return { error: "no encontrado" };

        return {
            ciudad: w.name,
            pais: w.sys.country,
            temperatura: w.main.temp,
            descripcion: w.weather[0].description,
            humedad: w.main.humidity
        };

    }catch(e){ return { error: e.message }; }
}

(function checkUrlParam(){
    const params = new URLSearchParams(location.search);
    const city = params.get("ciudad");

    if(city){
        const out = $id("resultadoClima");
        out.innerHTML = spinnerHTML("Cargando servicio...");

        obtenerClimaComoServicio(city).then(data => {
            out.innerHTML = `<pre>${JSON.stringify(data,null,2)}</pre>`;
        });
    }
})();

/* ======================================================
   COMPARTIR CLIMA
====================================================== */

$id("btnCompartirClima")?.addEventListener("click", () => {

    const city = ($id("ciudad").value || "").trim();
    if (!city){
        alert("Busca el clima de una ciudad antes de compartir.");
        return;
    }

    const raw = $id("resultadoClima")?.innerText || "";
    const txt = raw.slice(0, 400);

    $id("shareText").innerText = `Clima en ${city}:\n${txt}`;

    const enc = encodeURIComponent(`Clima en ${city}: ${txt}`);

    $id("linksCompartir").innerHTML = `
        <a class="share fb" href="https://www.facebook.com/sharer/sharer.php?u=&quote=${enc}" target="_blank">Facebook</a>
        <a class="share tw" href="https://twitter.com/intent/tweet?text=${enc}" target="_blank">Twitter</a>
        <a class="share wa" href="https://wa.me/?text=${enc}" target="_blank">WhatsApp</a>
    `;

    $id("shareBox").style.display = "flex";
});

$id("btnCloseShare")?.addEventListener("click", () => {
    $id("shareBox").style.display = "none";
});

$id("btnCopyShare")?.addEventListener("click", () => {
    navigator.clipboard.writeText($id("shareText").innerText);
    alert("Texto copiado ✔");
});

/* ======================================================
   BOTONES UI
====================================================== */

$id("btnBuscarClima")?.addEventListener("click", uiBuscarClima);
$id("ciudad")?.addEventListener("keyup", (e)=>{ if(e.key === "Enter") uiBuscarClima(); });
$id("btnBuscarPais")?.addEventListener("click", ui_buscarPais);
$id("btnTraducir")?.addEventListener("click", ui_traducir);
$id("btnConvertir")?.addEventListener("click", ui_convertir);

/* ======================================================
   CONTADOR DE VISITAS - VISIBLE (FUNCIONANDO)
====================================================== */

async function registrarVisita() {
    const url = "https://api.counterapi.dev/v2/portalsanti/contador/up";

    try {
        console.log("Llamando a:", url);
        const res = await fetch(url);

        console.log("Status:", res.status);

        const data = await res.json();
        console.log("Respuesta completa:", data);

        // Nueva API usa "data" (no "datos") y "up_count"
        if (!data || !data.data) {
            document.getElementById("contadorVisitas").innerText = "Error";
            console.error("data.data no existe");
            return;
        }

        const visitas = data.data.up_count;

        console.log("Visitas extraídas:", visitas);

        document.getElementById("contadorVisitas").innerText =
            visitas ?? "Error";

    } catch (e) {
        console.error("ERROR EN FETCH:", e);
        document.getElementById("contadorVisitas").innerText = "Error";
    }
}

registrarVisita();

/* ======================================================
   EXPORTAR API
====================================================== */

window.portal = {
    buscarClima: ui_consultarClimaDebounced,
    buscarPais: ui_buscarPais,
    traducir: ui_traducir,
    convertir: ui_convertir,
    obtenerClimaComoServicio,
    getHistory
};
