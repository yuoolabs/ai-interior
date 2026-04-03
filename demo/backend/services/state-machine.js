class ExecutionStateMachine {
  constructor({ pageAdapter, riskEngine, rolloutPolicy, auditService, maxRetries = 1 }) {
    this.pageAdapter = pageAdapter;
    this.riskEngine = riskEngine;
    this.rolloutPolicy = rolloutPolicy;
    this.auditService = auditService;
    this.maxRetries = maxRetries;
  }

  async execute({ run, draft, assets, runContext, emit, patchRun }) {
    const emitState = (state, step, message) => {
      patchRun({ state, currentStep: step, message });
      emit({ stage: "runtime_execution", title: step, message, status: stateToStatus(state), kind: "insight" });
    };

    emitState("running", "准备执行", "状态机已启动，准备执行页面自动装修");

    const draftForExecute = stripPublishNode(draft);

    let result;
    let attempt = 0;

    while (attempt <= this.maxRetries) {
      try {
        result = await this.pageAdapter.executeActionGraph({
          run,
          draft: draftForExecute,
          assets,
          emit: (event) => emit({ stage: "runtime_execution", ...event })
        });
        break;
      } catch (error) {
        attempt += 1;
        patchRun({ retries: attempt });
        emit({
          stage: "runtime_execution",
          title: "执行失败",
          message: error.message || "unknown_error",
          status: "failed",
          kind: "warning"
        });
        if (attempt > this.maxRetries) {
          throw error;
        }
      }
    }

    emitState("saved", "草稿已保存", "页面执行流程完成，进入风控校验阶段");

    const risk = this.riskEngine.evaluatePublish({ draft, assets, runContext });
    this.auditService.record({ runId: run.id, type: "risk_evaluation", details: risk, actor: "risk_engine" });

    emit({
      stage: "risk_control",
      title: "发布前风控判断",
      message: risk.allowPublish ? "风控已通过，可执行发布" : "风控拦截发布，请人工复核",
      status: risk.allowPublish ? "done" : "failed",
      kind: risk.allowPublish ? "result" : "warning",
      details: risk
    });

    const rollout = this.rolloutPolicy
      ? this.rolloutPolicy.evaluate({ runContext })
      : { allowPublish: true, blocked: false, reason: "rollout_policy_missing" };
    this.auditService.record({ runId: run.id, type: "rollout_policy", details: rollout, actor: "rollout_policy" });

    emit({
      stage: "risk_control",
      title: "发布灰度策略判断",
      message: rollout.allowPublish ? "灰度策略通过，可执行发布" : "灰度策略拦截发布",
      status: rollout.allowPublish ? "done" : "failed",
      kind: rollout.allowPublish ? "result" : "warning",
      details: rollout
    });

    if (!runContext.autoPublish) {
      patchRun({ state: "done", message: "自动执行完成，等待人工发布", currentStep: "等待发布" });
      return {
        execution: result,
        risk,
        rollout,
        published: false,
        publishResult: null
      };
    }

    if (!risk.allowPublish) {
      patchRun({ state: "blocked", message: "风控拦截，未发布", currentStep: "发布拦截" });
      return {
        execution: result,
        risk,
        rollout,
        published: false,
        publishResult: null
      };
    }

    if (!rollout.allowPublish) {
      patchRun({ state: "blocked", message: "灰度策略拦截，未发布", currentStep: "发布拦截" });
      return {
        execution: result,
        risk,
        rollout,
        published: false,
        publishResult: null
      };
    }

    emitState("publishing", "执行发布", "风控通过，正在执行自动发布");

    const publishResult = await this.pageAdapter.publish({
      pageId: result.pageId,
      runId: run.id
    });

    this.auditService.record({ runId: run.id, type: "publish", details: publishResult, actor: "page_adapter" });

    patchRun({
      state: "done",
      message: "已完成自动装修并发布",
      currentStep: "全部完成",
      outputs: {
        ...(run.outputs || {}),
        pageId: result.pageId,
        publishResult,
        risk
      }
    });

    emit({
      stage: "runtime_execution",
      title: "自动发布完成",
      message: "页面已完成自动发布",
      status: "done",
      kind: "result",
      details: publishResult
    });

    return {
      execution: result,
      risk,
      rollout,
      published: true,
      publishResult
    };
  }
}

function stripPublishNode(draft) {
  const actionGraph = draft?.execution?.actionGraph;
  if (!actionGraph) return draft;
  const nodes = (actionGraph.nodes || []).filter((node) => node.action !== "publish_page");
  const edges = actionGraph.edges.filter((edge) => nodes.some((node) => node.id === edge.from) && nodes.some((node) => node.id === edge.to));
  return {
    ...draft,
    execution: {
      ...draft.execution,
      actionGraph: {
        ...actionGraph,
        nodes,
        edges
      }
    }
  };
}

function stateToStatus(state) {
  if (state === "blocked") return "failed";
  if (state === "done" || state === "saved" || state === "publishing") return "running";
  return "running";
}

module.exports = {
  ExecutionStateMachine
};
