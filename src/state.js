'use strict';

// 服务启动时注入的共享状态
module.exports = {
  users: null, // UserStore 实例
  secret: null, // HMAC 签名密钥
};
