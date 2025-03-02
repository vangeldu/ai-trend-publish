import cron from "node-cron";
import { WeixinWorkflow } from "../services/weixin-article.workflow";
import { Workflow } from "../services/interfaces/workflow.interface";
import { WeixinAIBenchWorkflow } from "../services/weixin-aibench.workflow";
import { WeixinHelloGithubWorkflow } from "../services/weixin-hellogithub.workflow";

// 工作流映射表，用于存储不同日期对应的工作流
const workflowMap = new Map<number, Workflow>();

// 初始化工作流映射
const initializeWorkflows = () => {
  // 周一的工作流 (1)
  workflowMap.set(1, new WeixinWorkflow());
  // 其他日期的工作流可以在这里添加
  workflowMap.set(2, new WeixinWorkflow()); // 周二
  // workflowMap.set(3, new AnotherWorkflow()); // 周三
  workflowMap.set(3, new WeixinWorkflow()); // 周三

  workflowMap.set(4, new WeixinWorkflow());

  workflowMap.set(5, new WeixinWorkflow());

  workflowMap.set(6, new WeixinWorkflow());

  workflowMap.set(7, new WeixinWorkflow());



};

export const startCronJobs = async () => {
  console.log("初始化定时任务...");
  initializeWorkflows();

  // 每隔 10 分钟执行一次，只在早上 7 点到晚上 12 点之间执行
  cron.schedule(
    "*/10 7-23 * * *",
    async () => {
      const currentHour = new Date().getHours();
      const dayOfWeek = new Date().getDay(); // 0是周日，1-6是周一到周六
      const adjustedDay = dayOfWeek === 0 ? 7 : dayOfWeek; // 将周日的0转换为7
      
      console.log(`[定时任务] ${new Date().toLocaleString()} - 开始执行工作流...`);

      const workflow = workflowMap.get(adjustedDay);
      if (workflow) {
        console.log(`[定时任务] 执行周${adjustedDay}的工作流...`);
        try {
          await workflow.refresh();
          await workflow.process();
          console.log(`[定时任务] 工作流执行完成，等待下一次执行...`);
        } catch (error) {
          console.error(`[定时任务] 工作流执行失败:`, error);
        }
      } else {
        console.log(`[定时任务] 周${adjustedDay}没有配置对应的工作流`);
      }
    },
    {
      timezone: "Asia/Shanghai",
    }
  );
  
  console.log("[定时任务] 已设置每隔 10 分钟执行一次工作流，仅在早上 7 点到晚上 12 点之间");
};
