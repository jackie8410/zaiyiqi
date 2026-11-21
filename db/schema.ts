import { sqliteTable, text, integer, index, check } from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';
export const users = sqliteTable('users', { id:text('id').primaryKey(), name:text('name').notNull(), credits:integer('credits').notNull().default(2), proUntil:integer('pro_until').notNull().default(0), created:integer('created').notNull() });
export const photos = sqliteTable('photos', { id:text('id').primaryKey(), owner:text('owner').notNull(), key:text('object_key').notNull(), name:text('name').notNull(), mime:text('mime').notNull(), size:integer('size').notNull(), kind:text('kind').notNull(), created:integer('created').notNull() });
export const albums = sqliteTable('albums', { id:text('id').primaryKey(), owner:text('owner').notNull(), title:text('title').notNull(), subtitle:text('subtitle').notNull().default(''), theme:text('theme').notNull(), mode:text('mode').notNull(), pages:text('pages').notNull(), visibility:text('visibility').notNull().default('private'), shareToken:text('share_token'), passwordHash:text('password_hash'), revision:integer('revision').notNull().default(1), created:integer('created').notNull(), updated:integer('updated').notNull() });
export const jobs = sqliteTable('jobs', { id:text('id').primaryKey(), owner:text('owner').notNull(), kind:text('kind').notNull(), config:text('config').notNull(), sources:text('sources').notNull(), results:text('results').notNull().default('[]'), attempts:integer('attempts').notNull().default(0), status:text('status').notNull(), charged:integer('charged').notNull().default(0), error:text('error'), created:integer('created').notNull(), updated:integer('updated').notNull() });
export const comments = sqliteTable('comments', { id:text('id').primaryKey(), albumId:text('album_id').notNull(), owner:text('owner').notNull(), name:text('name').notNull(), body:text('body').notNull(), created:integer('created').notNull() });
export const likes = sqliteTable('likes', { id:text('id').primaryKey(), albumId:text('album_id').notNull(), owner:text('owner').notNull() });
export const ratings = sqliteTable('ratings', { id:text('id').primaryKey(), albumId:text('album_id').notNull(), owner:text('owner').notNull(), score:integer('score').notNull() });
export const orders = sqliteTable('orders', { id:text('id').primaryKey(), owner:text('owner').notNull(), product:text('product').notNull(), channel:text('channel').notNull(), amount:integer('amount').notNull(), status:text('status').notNull(), transactionId:text('transaction_id').unique(), created:integer('created').notNull(), paid:integer('paid') });
export const sessions = sqliteTable('share_sessions', { id:text('id').primaryKey(), albumId:text('album_id').notNull(), expires:integer('expires').notNull() });
export const limits = sqliteTable('rate_limits', { id:text('id').primaryKey(), count:integer('count').notNull(), expires:integer('expires').notNull() });
export const emailAccounts=sqliteTable('email_accounts',{
 userId:text('user_id').primaryKey().references(()=>users.id),email:text('email').notNull().unique(),status:text('status').notNull(),application:text('application').notNull().default(''),reviewNote:text('review_note').notNull().default(''),verifiedAt:integer('verified_at').notNull(),reviewedAt:integer('reviewed_at'),reviewedBy:text('reviewed_by'),created:integer('created').notNull()
},t=>[check('email_accounts_status',sql`${t.status} IN ('pending','approved','rejected','suspended')`)]);
export const emailCodes=sqliteTable('email_codes',{
 id:text('id').primaryKey(),email:text('email').notNull(),codeHash:text('code_hash').notNull(),purpose:text('purpose').notNull(),name:text('name').notNull().default(''),application:text('application').notNull().default(''),expires:integer('expires').notNull(),attempts:integer('attempts').notNull().default(0),consumed:integer('consumed'),created:integer('created').notNull()
},t=>[index('email_codes_expiry').on(t.expires)]);
export const accountSessions=sqliteTable('account_sessions',{
 tokenHash:text('token_hash').primaryKey(),userId:text('user_id').notNull().references(()=>users.id),expires:integer('expires').notNull(),created:integer('created').notNull()
},t=>[index('account_sessions_user').on(t.userId)]);
export const accountReviews=sqliteTable('account_reviews',{
 id:text('id').primaryKey(),userId:text('user_id').notNull(),actorId:text('actor_id').notNull(),previousStatus:text('previous_status').notNull(),status:text('status').notNull(),note:text('note').notNull(),created:integer('created').notNull()
});
// Additive administration tables: existing accounts, files and balances are untouched.
export const siteSettings=sqliteTable('site_settings',{
 id:text('id').primaryKey(),value:text('value').notNull(),revision:integer('revision').notNull(),updated:integer('updated').notNull(),actor:text('actor').notNull()
});
export const adminAudit=sqliteTable('admin_audit',{
 id:text('id').primaryKey(),actor:text('actor').notNull(),action:text('action').notNull(),detail:text('detail').notNull(),created:integer('created').notNull()
});
export const maintenanceLock=sqliteTable('maintenance_lock',{
 id:text('id').primaryKey(),operation:text('operation').notNull(),owner:text('owner').notNull(),expires:integer('expires').notNull()
});
export const writeLeases=sqliteTable('write_leases',{
 id:text('id').primaryKey(),expires:integer('expires').notNull()
});
export const adminOperations=sqliteTable('admin_operations',{
 id:text('id').primaryKey(),owner:text('owner').notNull(),kind:text('kind').notNull(),status:text('status').notNull(),created:integer('created').notNull(),expires:integer('expires').notNull()
});
