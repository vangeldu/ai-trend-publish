import {
  ContentScraper,
  ScrapedContent,
} from "../scrapers/interfaces/scraper.interface";
import { ContentSummarizer } from "../summarizer/interfaces/summarizer.interface";
import { ContentPublisher } from "../publishers/interfaces/publisher.interface";
import { WeixinPublisher } from "../publishers/weixin.publisher";
import { DeepseekAISummarizer } from "../summarizer/deepseek-ai.summarizer";
import { BarkNotifier } from "../utils/bark.notify";
import dotenv from "dotenv";
import { TwitterScraper } from "../scrapers/twitter.scraper";
import { FireCrawlScraper } from "../scrapers/fireCrawl.scraper";
import { getCronSources } from "../data-sources/getCronSources";
import cliProgress from "cli-progress";
import { WeixinTemplate } from "../render/interfaces/template.interface";
import { WeixinTemplateRenderer } from "../render/weixin/renderer";
import { AliWanX21ImageGenerator } from "../utils/gen-image/aliwanx2.1.image";
import { DeepseekAPI } from "../api/deepseek.api";
import { ContentRanker, RankResult } from "../utils/content-rank/content-ranker";
import { QianwenAISummarizer } from "../summarizer/qianwen-ai.summarizer";
import { ConfigManager } from "../utils/config/config-manager";
import axios from "axios";

dotenv.config();

export class WeixinWorkflow {
  private scraper: Map<string, ContentScraper>;
  private summarizer: ContentSummarizer;
  private publisher: ContentPublisher;
  private notifier: BarkNotifier;
  private renderer: WeixinTemplateRenderer;
  private imageGenerator: AliWanX21ImageGenerator;
  private deepSeekClient: DeepseekAPI;
  private stats = {
    success: 0,
    failed: 0,
    contents: 0,
  };

  constructor() {
    this.scraper = new Map<string, ContentScraper>();
    this.scraper.set("fireCrawl", new FireCrawlScraper());
    this.scraper.set("twitter", new TwitterScraper());
    this.summarizer = new DeepseekAISummarizer();
    this.publisher = new WeixinPublisher();
    this.notifier = new BarkNotifier();
    this.renderer = new WeixinTemplateRenderer();
    this.imageGenerator = new AliWanX21ImageGenerator();
    this.deepSeekClient = new DeepseekAPI();
  }

  async refresh(): Promise<void> {
    await this.notifier.refresh();
    await this.summarizer.refresh();
    await this.publisher.refresh();
    await this.scraper.get("fireCrawl")?.refresh();
    await this.scraper.get("twitter")?.refresh();
    await this.imageGenerator.refresh();
    await this.deepSeekClient.refresh();
  }

  private async scrapeSource(
    type: string,
    source: { identifier: string },
    scraper: ContentScraper
  ): Promise<ScrapedContent[]> {
    try {
      console.log(`[${type}] 抓取: ${source.identifier}`);
      const contents = await scraper.scrape(source.identifier);
      this.stats.success++;
      return contents;
    } catch (error) {
      this.stats.failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[${type}] ${source.identifier} 抓取失败:`, message);
      await this.notifier.warning(
        `${type}抓取失败`,
        `源: ${source.identifier}\n错误: ${message}`
      );
      return [];
    }
  }

  private async processContent(content: ScrapedContent): Promise<void> {
    try {
      const summary = await this.summarizer.summarize(JSON.stringify(content));
      content.title = summary.title;
      content.content = summary.content;
      content.score = summary.score;
      content.metadata.keywords = summary.keywords;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[内容处理] ${content.id} 处理失败:`, message);
      await this.notifier.warning(
        "内容处理失败",
        `ID: ${content.id}\n保留原始内容`
      );
      content.title = content.title || "无标题";
      content.content = content.content || "内容处理失败";
      content.metadata.keywords = content.metadata.keywords || [];
    }
  }

  async process(): Promise<void> {
    try {
      console.log("=== 开始执行微信工作流 ===");
      await this.notifier.info("工作流开始", "开始执行内容抓取和处理");

      // 检查 API 额度
      // deepseek
      const deepSeekBalance = await this.deepSeekClient.getCNYBalance();
      console.log("DeepSeek余额：", deepSeekBalance);
      if (deepSeekBalance < 1.0) {
        this.notifier.warning("DeepSeek", "余额小于一元");
      }
      // 1. 获取数据源
      const sourceConfigs = await getCronSources();

      // 修改为从 sourceConfigs.All.api 获取接口 URL
      console.log("[数据源] 从 API 获取数据");
      
      // 检查 API URL 是否存在
      if (!sourceConfigs.All || !sourceConfigs.All.api || sourceConfigs.All.api.length === 0) {
        throw new Error("API URL 未配置，请检查 sourceConfigs.All.api");
      }
      
      // 获取第一个 API URL
      const apiUrl = sourceConfigs.All.api[0].identifier;
      console.log(`[数据源] API URL: ${apiUrl}`);
      
      // 请求 API 获取数据
      let apiData: { data: Array<{
        author: string;
        cover: string;
        id: string;
        mobileUrl: string;
        timestamp: number;
        title: string;
        url: string;
      }> } = { data: [] };
      
      try {
        console.log("[数据源] 开始请求 API 数据");
        const response = await axios.get(apiUrl);
        apiData = response.data;
        console.log(`[数据源] 获取到 ${apiData.data.length} 条数据`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[数据源] API 请求失败: ${message}`);
        await this.notifier.error("API 请求失败", message);
        throw error;
      }

      apiData.data = apiData.data.splice(0,5) // TODO
      
      if (!apiData.data || apiData.data.length === 0) {
        const message = "API 返回数据为空";
        console.error(`[数据源] ${message}`);
        await this.notifier.error("数据源错误", message);
        throw new Error(message);
      }

      // 2. 抓取、处理和发布内容
      console.log(`\n[工作流] 开始抓取、处理和发布 ${apiData.data.length} 条内容`);
      const progress = new cliProgress.SingleBar(
        {},
        cliProgress.Presets.shades_classic
      );
      progress.start(apiData.data.length, 0);
      
      // 获取 FireCrawl 抓取器
      const fireCrawlScraper = this.scraper.get("fireCrawl");
      if (!fireCrawlScraper) throw new Error("FireCrawlScraper not found");
      
      const publishResults = [];
      let processedCount = 0;
      
      // 逐个抓取、处理和发布内容
      for (const item of apiData.data) {
        try {
          // 1. 抓取内容
          console.log(`[抓取] 抓取内容: ${item.title} (${item.url})`);
          const contents = await fireCrawlScraper.scrape(item.url);
          
          if (contents.length === 0) {
            console.log(`[抓取] 未从 ${item.url} 抓取到内容，跳过`);
            this.stats.failed++;
            progress.update(++processedCount);
            continue;
          }
          
          // 使用第一个内容（通常只有一个）
          const content = contents[0];
          
          // 2. 处理内容
          console.log(`[处理] 处理内容: ${content.id}`);
          await this.processContent(content);
          
          // 3. 转换为模板数据
          const article: WeixinTemplate = {
            id: content.id,
            title: content.title,
            content: content.content,
            url: content.url,
            publishDate: content.publishDate,
            metadata: content.metadata,
            keywords: content.metadata.keywords,
          };
          
          // 4. 生成封面
          let mediaId = "";
          
            // 生成新封面
          mediaId = await this.generateAndUploadCover(article.title);
          
          
          // 5. 渲染单篇文章模板
          const singleArticleTemplate = this.renderer.render([article]);
          
          // 6. 立即发布文章
          console.log(`[发布] 发布文章: ${article.title}`);
          const publishResult = await this.publisher.publish(
            singleArticleTemplate,
            article.title,
            article.title,
            mediaId
          );
          
          publishResults.push(publishResult);
          console.log(`[发布结果] 文章 "${article.title}" 发布状态: ${publishResult.status}`);
          
          this.stats.success++;
          this.stats.contents++;
        } catch (error) {
          this.stats.failed++;
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[处理] ${item.url} 处理失败:`, message);
          await this.notifier.warning(
            "内容处理失败",
            `URL: ${item.url}\n错误: ${message}`
          );
        }
        
        progress.update(++processedCount);
      }
      
      progress.stop();
      
      // 检查是否有成功处理的内容
      if (this.stats.contents === 0) {
        const message = "未成功处理任何内容";
        console.error(`[工作流] ${message}`);
        await this.notifier.error("工作流终止", message);
        return;
      }

      // 添加延迟，确保之前的所有日志都已输出
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 添加明显的分隔线，使最终总结更加突出
      console.log("\n\n");
      console.log("=".repeat(80));
      console.log("=".repeat(30) + " 工作流执行完成 " + "=".repeat(30));
      console.log("=".repeat(80));
      
      // 完成报告
      const successCount = publishResults.filter(r => r.status === "published" || r.status === "draft").length;
      const failedCount = publishResults.length - successCount;
      
      const summary = `
        工作流执行完成
        - 数据源: ${apiData.data.length} 个
        - 成功: ${this.stats.success} 个
        - 失败: ${this.stats.failed} 个
        - 内容: ${this.stats.contents} 条
        - 发布: ${successCount} 成功, ${failedCount} 失败`.trim();

      console.log(summary);
      console.log("=".repeat(80));
      console.log("\n");

      // 确保通知是最后发送的
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (this.stats.failed > 0 || failedCount > 0) {
        await this.notifier.warning("工作流完成(部分失败)", summary);
      } else {
        await this.notifier.success("工作流完成", summary);
      }
      
      // 最后再输出一次，确保这是控制台的最后内容
      console.log("\n[工作流] 所有操作已完成，退出程序");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[工作流] 执行失败:", message);
      await this.notifier.error("工作流失败", message);
      throw error;
    }
  }

  private async generateAndUploadCover(title: string): Promise<string> {
    // 为文章生成封面图片，使用标题作为提示词
    console.log(`[封面图片] 为文章生成封面图片: ${title}`);
    const taskId = await this.imageGenerator
      .generateImage(`帮我生成一个标题封面，标题是：${title} ,封面不需要文字，找最符合标题的图片`, "1440*768")
      .then((res) => res.output.task_id);
    
    console.log(`[封面图片] 封面图片生成任务ID: ${taskId}`);
    const imageUrl = await this.imageGenerator
      .waitForCompletion(taskId)
      .then((res) => res.results?.[0]?.url)
      .then((url) => {
        if (!url) {
          throw new Error("封面图片生成失败");
        }
        return url;
      });

    // 上传封面图片
    const mediaId = await this.publisher.uploadImage(imageUrl);
    console.log(`[封面图片] 封面图片上传成功，媒体ID: ${mediaId}`);

    return mediaId;
  }
}
