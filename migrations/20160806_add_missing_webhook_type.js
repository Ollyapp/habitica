'use strict';

/****************************************
 * Author: Blade Barringer @crookedneighbor
 *
 * Reason: Webhooks have been moved from
 * being an object on preferences.webhooks
 * to being an array on webhooks. In addition
 * they support a type and options
* ***************************************/

global.Promise = require('bluebird');
const TaskQueue = require('cwait').TaskQueue;
const logger = require('./utils/logger');
const Timer = require('./utils/timer');
const connectToDb = require('./utils/connect').connectToDb;
const closeDb = require('./utils/connect').closeDb;
const validator = require('validator');

const timer = new Timer();
const MIGRATION_NAME = '20160806_add_missing_webhook_type.js';

// const DB_URI = 'mongodb://username:password@dsXXXXXX-a0.mlab.com:XXXXX,dsXXXXXX-a1.mlab.com:XXXXX/habitica?replicaSet=rs-dsXXXXXX';
const DB_URI = 'mongodb://localhost/prod-copy-4';

const LOGGEDIN_DATE_RANGE = {
  $gte: new Date("2014-01-01T00:00:00.000Z"),
  $lte: new Date("2014-06-01T00:00:00.000Z"),
};

let Users;

connectToDb(DB_URI).then((db) => {
  Users = db.collection('users');

  return Promise.resolve();
})
.then(findUsersWithWebhooks)
.then(correctWebhooks)
.then(() => {
  timer.stop();
  closeDb();
}).catch(reportError);

function reportError (err) {
  logger.error('Uh oh, an error occurred');
  closeDb();
  timer.stop();
  throw err;
}

// Cached ids of users that need updating
const USER_IDS = require('../ids.json');

function findUsersWithWebhooks () {
  logger.warn('Fetching users with webhooks...');

  return Users.find({'_id': {$in: USER_IDS}}, ['preferences.webhooks']).toArray().then((docs) => {
  // return Users.find({'preferences.webhooks': {$ne: {} }}, ['preferences.webhooks']).toArray().then((docs) => {
  // TODO: Run this after the initial migration to catch any webhooks that may have been aded since the prod backup download
  // return Users.find({'preferences.webhooks': {$ne: {} }, 'auth.timestamps.loggedin': {$gte: new Date("2016-08-04T00:00:00.000Z")}}, ['preferences.webhooks']).toArray().then((docs) => {
    let updates = docs.map((user) => {
      let oldWebhooks = user.preferences.webhooks;
      let webhooks = Object.keys(oldWebhooks).map((id) => {
        let webhook = oldWebhooks[id]

        webhook.type = 'taskActivity';
        webhook.options = {
          created: false,
          updated: false,
          deleted: false,
          scored: true,
        };

        return webhook;
      });

      return {
        webhooks,
        id: user._id,
      }
    });

    return Promise.resolve(updates);
  });
}

function updateUserById (user) {
  let userId = user.id;
  let webhooks = user.webhooks;

  return Users.findOneAndUpdate({
    _id: userId},
    {$set: {webhooks: webhooks, migration: MIGRATION_NAME}
  }, {returnOriginal: false})
}

function correctWebhooks (users) {
  let queue = new TaskQueue(Promise, 300);

  logger.warn('About to update', users.length, 'users...');

  return Promise.map(users, queue.wrap(updateUserById)).then((result) => {
    let updates = result.filter(res => res.lastErrorObject && res.lastErrorObject.updatedExisting)
    let failures = result.filter(res => !(res.lastErrorObject && res.lastErrorObject.updatedExisting));

    logger.warn(updates.length, 'users have been fixed');

    if (failures.length > 0) {
      logger.error(failures.length, 'users could not be found');
    }

    return Promise.resolve();
  });
}