// btc-rsi-checker.js
const axios = require('axios');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;

// Đọc cấu hình từ config.json
async function loadConfig() {
  try {
    const configData = await fs.readFile('config.json', 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    console.error('Lỗi khi đọc cấu hình:', error);
    // Trả về cấu hình mặc định nếu không đọc được file
    return {
      email: process.env.ALERT_EMAIL || "lethequyen13@gmail.com",
      threshold: process.env.ALERT_THRESHOLD || 45,
      period: process.env.ALERT_PERIOD || "24",
      condition: process.env.ALERT_CONDITION || "below"
    };
  }
}

// Hàm tính RSI - giống phương pháp trong script gốc
function calculateRSI(closes, period) {
  const changes = [];
  // Tính toán các thay đổi giá
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i-1]);
  }
  
  if (changes.length < period) {
    return [];
  }

  const rsiValues = [];
  // Pad đầu mảng để đảm bảo độ dài chính xác
  for (let i = 0; i < period - 1; i++) {
    rsiValues.push(null);
  }
  
  // Tính RSI đầu tiên
  let ups = 0;
  let downs = 0;
  
  for (let i = 0; i < period; i++) {
    const change = changes[i];
    if (change > 0) ups += change;
    else downs -= change;
  }
  
  // Đảm bảo không chia cho 0
  downs = downs || 0.00001;
  
  let avgUp = ups / period;
  let avgDown = downs / period;
  let rs = avgUp / avgDown;
  let rsi = 100 - (100 / (1 + rs));
  rsiValues.push(rsi);
  
  // Tính các RSI tiếp theo
  for (let i = period; i < changes.length; i++) {
    const change = changes[i];
    let currUp = 0;
    let currDown = 0;
    
    if (change > 0) currUp = change;
    else currDown = -change;
    
    // Cập nhật giá trị trung bình theo phương pháp exponential (Giống Binance)
    avgUp = ((avgUp * (period - 1)) + currUp) / period;
    avgDown = ((avgDown * (period - 1)) + currDown) / period;
    
    // Đảm bảo không chia cho 0
    if (avgDown === 0) avgDown = 0.00001;
    
    rs = avgUp / avgDown;
    rsi = 100 - (100 / (1 + rs));
    rsiValues.push(rsi);
  }
  
  return rsiValues;
}

// Hàm gửi email thông báo
async function sendEmailAlert(config, rsiValue, price) {
  try {
    // Sử dụng SMTP credentials từ GitHub Secrets
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const rsiPeriod = config.period === '6' ? 'RSI(6)' : 'RSI(24)';
    const conditionText = config.condition === 'below' ? 'thấp hơn' : 'cao hơn';
    
    // Chuẩn bị nội dung email
    const subject = `Cảnh báo ${rsiPeriod} BTC ${conditionText} ${config.threshold}`;
    const text = `
    ${rsiPeriod} hiện tại là ${rsiValue.toFixed(2)}, ${conditionText} ngưỡng ${config.threshold}.
    Giá BTC hiện tại: $${price.toFixed(2)}
    Thời gian: ${new Date().toLocaleString()}
    `;
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: config.email,
      subject: subject,
      text: text
    };
    
    // Gửi email
    const info = await transporter.sendMail(mailOptions);
    console.log('Email đã gửi thành công:', info.response);
    
    // Lưu thời gian gửi email cuối cùng
    await saveLastAlertTime();
    
  } catch (err) {
    console.error('Lỗi gửi email:', err);
  }
}

// Lưu thời gian gửi email cuối cùng vào một file
async function saveLastAlertTime() {
  try {
    const data = {
      lastAlertSent: Date.now()
    };
    await fs.writeFile('last-alert.json', JSON.stringify(data), 'utf8');
  } catch (err) {
    console.error('Lỗi khi lưu thời gian cảnh báo:', err);
  }
}

// Đọc thời gian gửi email cuối cùng
async function getLastAlertTime() {
  try {
    const data = await fs.readFile('last-alert.json', 'utf8');
    return JSON.parse(data).lastAlertSent;
  } catch (err) {
    // Nếu không có file hoặc có lỗi, trả về 0 để cho phép gửi email ngay lập tức
    return 0;
  }
}

// Hàm chính để kiểm tra RSI và gửi cảnh báo
async function checkRSIAndAlert() {
  try {
    // Tải cấu hình
    const config = await loadConfig();
    
    // Lấy dữ liệu BTC từ Binance API
    const response = await axios.get('https://api.binance.com/api/v3/klines', {
      params: {
        symbol: 'BTCUSDT',
        interval: '1h',
        limit: 100
      }
    });
    
    const data = response.data;
    
    // Xử lý dữ liệu
    const candles = data.map(candle => ({
      close: parseFloat(candle[4]),
      time: new Date(candle[0]),
      timestamp: candle[0]
    }));
    
    // Sắp xếp theo thời gian tăng dần
    candles.sort((a, b) => a.timestamp - b.timestamp);
    
    const closes = candles.map(c => c.close);
    
    // Tính RSI 6 và RSI 24
    const rsi6Values = calculateRSI(closes, 6);
    const rsi24Values = calculateRSI(closes, 24);
    
    // Lấy giá trị hiện tại
    const currentRSI6 = rsi6Values[rsi6Values.length-1];
    const currentRSI24 = rsi24Values[rsi24Values.length-1];
    const currentPrice = closes[closes.length-1];
    
    // Log thông tin
    console.log(`RSI 6 hiện tại: ${currentRSI6.toFixed(2)}`);
    console.log(`RSI 24 hiện tại: ${currentRSI24.toFixed(2)}`);
    console.log(`Giá BTC hiện tại: $${currentPrice.toFixed(2)}`);
    console.log(`Cấu hình cảnh báo: ${config.condition} ${config.threshold}, RSI(${config.period})`);
    
    // Chọn RSI dựa trên period
    const rsiValue = config.period === '6' ? currentRSI6 : currentRSI24;
    
    // Kiểm tra điều kiện cảnh báo
    let shouldAlert = false;
    
    if (config.condition === 'below' && rsiValue < parseFloat(config.threshold)) {
      shouldAlert = true;
      console.log(`Phát hiện điều kiện cảnh báo: RSI(${config.period}) = ${rsiValue.toFixed(2)} thấp hơn ${config.threshold}`);
    } else if (config.condition === 'above' && rsiValue > parseFloat(config.threshold)) {
      shouldAlert = true;
      console.log(`Phát hiện điều kiện cảnh báo: RSI(${config.period}) = ${rsiValue.toFixed(2)} cao hơn ${config.threshold}`);
    }
    
    // Kiểm tra thời gian gửi email cuối cùng để tránh spam
    if (shouldAlert) {
      const lastAlertTime = await getLastAlertTime();
      const hoursPassed = (Date.now() - parseInt(lastAlertTime)) / 3600000;
      
      if (hoursPassed >= 1) { // Chỉ gửi email tối đa 1 lần/giờ
        console.log('Gửi cảnh báo email...');
        await sendEmailAlert(config, rsiValue, currentPrice);
      } else {
        console.log(`Đã gửi cảnh báo trong ${hoursPassed.toFixed(2)} giờ qua. Bỏ qua để tránh spam.`);
      }
    } else {
      console.log('Không có điều kiện cảnh báo nào được kích hoạt.');
    }
    
  } catch (error) {
    console.error('Lỗi trong quá trình kiểm tra RSI:', error);
  }
}

// Chạy hàm chính khi script được thực thi
checkRSIAndAlert();
