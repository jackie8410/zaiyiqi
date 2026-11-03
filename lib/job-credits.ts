import {db,now,HttpError} from './server';
// charged: 0 = not charged, 2 = reserved, 1 = successful task paid.
export async function reserveJobCredit(id:string,owner:string){await db().batch([
 db().prepare('UPDATE jobs SET charged=2 WHERE id=? AND owner=? AND charged=0 AND EXISTS(SELECT 1 FROM users WHERE id=? AND credits>0)').bind(id,owner,owner),
 db().prepare('UPDATE users SET credits=credits-1 WHERE id=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND owner=? AND charged=2)').bind(owner,id,owner)
 ]);const j:any=await db().prepare('SELECT charged FROM jobs WHERE id=? AND owner=?').bind(id,owner).first();if(j?.charged!==2)throw new HttpError('创作任务额度已用完',402);}
export async function refundJobCredit(id:string,owner:string){await db().batch([
 db().prepare('UPDATE users SET credits=credits+1 WHERE id=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND owner=? AND charged=2)').bind(owner,id,owner),
 db().prepare('UPDATE jobs SET charged=0 WHERE id=? AND owner=? AND charged=2').bind(id,owner)
 ]);}
export async function recoverStalledJobs(owner:string){const cutoff=now()-300000;await db().batch([
 db().prepare("UPDATE users SET credits=credits+(SELECT COUNT(*) FROM jobs WHERE owner=? AND status='running' AND charged=2 AND updated<?) WHERE id=?").bind(owner,cutoff,owner),
 db().prepare("UPDATE jobs SET status='failed',charged=CASE WHEN charged=2 THEN 0 ELSE charged END,error='上次生成连接中断，已恢复未使用的任务额度，可以重试。',updated=? WHERE owner=? AND status='running' AND updated<?").bind(now(),owner,cutoff)
 ]);}
