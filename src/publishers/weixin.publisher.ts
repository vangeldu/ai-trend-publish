import {
  ContentPublisher,
  PublishResult,
} from "./interfaces/publisher.interface";
import dotenv from "dotenv";
import axios from "axios";
import { ConfigManager } from "../utils/config/config-manager";
import { AliWanX21ImageGenerator } from "../utils/gen-image/aliwanx2.1.image";

dotenv.config();

interface WeixinToken {
  access_token: string;
  expires_in: number;
  expiresAt: Date;
}

interface WeixinDraft {
  media_id: string;
  article_id?: string;
}

export class WeixinPublisher implements ContentPublisher {
  private accessToken: WeixinToken | null = null;
  private appId: string | undefined;
  private appSecret: string | undefined;

  constructor() {
    this.refresh();
  }

  async refresh(): Promise<void> {
    await this.validateConfig();
    this.appId = await ConfigManager.getInstance().get("WEIXIN_APP_ID");
    this.appSecret = await ConfigManager.getInstance().get("WEIXIN_APP_SECRET");
  }

  async validateConfig(): Promise<void> {
    if (
      !(await ConfigManager.getInstance().get("WEIXIN_APP_ID")) ||
      !(await ConfigManager.getInstance().get("WEIXIN_APP_SECRET"))
    ) {
      throw new Error(
        "微信公众号配置不完整，请检查 WEIXIN_APP_ID 和 WEIXIN_APP_SECRET"
      );
    }
  }

  private async ensureAccessToken(): Promise<string> {
    // 检查现有token是否有效
    if (
      this.accessToken &&
      this.accessToken.expiresAt > new Date(Date.now() + 60000) // 预留1分钟余量
    ) {
      return this.accessToken.access_token;
    }

    // 获取新token
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${this.appId}&secret=${this.appSecret}`;

    try {
      const response = await axios.get(url);
      const { access_token, expires_in } = response.data;

      if (!access_token) {
        throw new Error(
          "获取access_token失败: " + JSON.stringify(response.data)
        );
      }

      this.accessToken = {
        access_token,
        expires_in,
        expiresAt: new Date(Date.now() + expires_in * 1000),
      };

      return access_token;
    } catch (error) {
      console.error("获取微信access_token失败:", error);
      throw error;
    }
  }

  private async uploadDraft(
    article: string,
    title: string,
    digest: string,
    mediaId: string
  ): Promise<WeixinDraft> {
    const token = await this.ensureAccessToken();
    const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`;

    const articles = [
      {
        title: title,
        author: "小杜",
        digest: digest,
        content: article,
        thumb_media_id: mediaId,
        need_open_comment: 0,
        only_fans_can_comment: 0,
      },
    ];

    try {
      const response = await axios.post(url, {
        articles,
      });

      if (response.data.errcode) {
        throw new Error(`上传草稿失败: ${response.data.errmsg}`);
      }

      return {
        media_id: response.data.media_id,
      };
    } catch (error) {
      console.error("上传微信草稿失败:", error);
      throw error;
    }
  }
  /**
   * 上传图片到微信
   * @param imageUrl 图片URL
   * @returns 图片ID
   */
  async uploadImage(imageUrl: string): Promise<string> {
    if (!imageUrl) {
      // 如果图片URL为空，则返回一个默认的图片ID
      return "SwCSRjrdGJNaWioRQUHzgF68BHFkSlb_f5xlTquvsOSA6Yy0ZRjFo0aW9eS3JJu_";
    }
    const imageBuffer = await axios.get(imageUrl, {
      responseType: "arraybuffer",
    });

    const token = await this.ensureAccessToken();
    const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`;

    try {
      // 创建FormData并添加图片数据
      const formData = new FormData();
      formData.append(
        "media",
        new Blob([imageBuffer.data], { type: "image/jpeg" }),
        `image_${Math.random().toString(36).substring(2, 8)}.jpg`
      );

      const response = await axios.post(url, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
          Accept: "*/*",
        },
      });

      if (response.data.errcode) {
        throw new Error(`上传图片失败: ${response.data.errmsg}`);
      }

      return response.data.media_id;
    } catch (error) {
      console.error("上传微信图片失败:", error);
      throw error;
    }
  }

  /**
   * 发布文章到微信
   * @param article 文章内容
   * @param title 文章标题
   * @param digest 文章摘要
   * @param mediaId 图片ID
   * @returns 发布结果
   */
  async publish(
    article: string,
    title: string,
    digest: string,
    mediaId: string
  ): Promise<PublishResult> {
    try {
      // 上传草稿
      const draft = await this.uploadDraft(article, title, digest, mediaId);
      return {
        publishId: draft.media_id,
        status: "draft",
        publishedAt: new Date(),
        platform: "weixin",
        url: `https://mp.weixin.qq.com/s/${draft.media_id}`,
      };
    } catch (error) {
      console.error("微信发布失败:", error);
      throw error;
    }
  }
}
