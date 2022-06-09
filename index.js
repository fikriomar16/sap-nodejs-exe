const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = 3000;
const open = require('open');
const {argv} = require('yargs');
const path = require('path');
const fs = require('fs');
const dir = './logsap/';

const { Pool } = require('pg');
const pool = new Pool({
	user: 'root',
	host: '127.0.0.1',
	database: 'biosecurity-boot',
	password: 'ZKTeco##123',
	port: 5442
});

const {Connection,Request} = require('tedious');
const DB_SAP = 'HITFPTA';
const DB_SCH = 'Canteen';
const SAPtable = 'AtLogRegio';
const SCHtable = 'HRPT63';

const conf_sqlsrv = (database) => {
	return {
		server: "10.126.25.151",
		// server: "192.168.1.9",
		authentication: {
			type: 'default',
			options: {
				userName: 'Regio',
				password: 'regio'
			}
		},
		options: {
			encrypt: false,
			database: database,
			enableArithAbort: false,
			trustServerCertificate: true,
			instanceName: 'SQLEXPRESS',
			rowCollectionOnRequestCompletion: true
		},
		pool: {
			min: 0,
			max: 10,
			idleTimeoutMillis: 30000
		}
	}
};

const date = new Date();
const curY = date.getFullYear();
const month = String(date.getMonth()+1);
const curM = () => {
	if (month.length < 2) {
		return `0${month}`;
	} else {
		return month;
	}
};
const curD = () => {
	if (String(date.getDate()).length < 2) {
		return `0${String(date.getDate())}`;
	} else {
		return String(date.getDate())
	}
};
const today = `${curY}-${curM()}-${curD()}`;
const curDm1 = () => {
	const ytd = new Date(today);
	ytd.setDate(ytd.getDate()-1);
	let ystd = ytd.toISOString().split('T')[0];
	return ystd;
};
const yesterday = curDm1();
const send1000 = {
	start: `${yesterday} 10:00:00`,
	end: `${today} 00:00:00`
}
const send0010 = {
	start: `${today} 00:00:00`,
	end: `${today} 10:00:00`
}
let whereCond = {
	start: `2022-02-08 10:00:00`,
	end: `2022-02-09 00:00:00`
}

const createLogFolder = () => {
	if (!fs.existsSync(dir)){
		fs.mkdirSync(dir);
	}
}
// createLogFolder();

const qSch = `SELECT * FROM ${SCHtable} WHERE CAST(DATE as date)='${today}' AND LEFT(DWS,3) != 'OFF'`;
const query_ = (start,end) => {
	return `
	SELECT name as ID, pin as f01, 
	date_part('year',MIN(event_time)) as f02, 
	date_part('month',MIN(event_time)) as f03, 
	date_part('day',MIN(event_time)) as f04, 
	date_part('hour',MIN(event_time)) as f05, 
	date_part('minute',MIN(event_time)) as f06, 
	NULL as f07, NULL as f08, NULL as f09, 
	RIGHT(dev_sn,4) as f10,  
	NULL as crtdt, NULL as flag
	FROM acc_transaction where split_part(dev_alias, '-', 1)='IN' and pin!= '' and event_time >= '${start}' and event_time <= '${end}' and verify_mode_no != 4
	GROUP BY pin,name,dev_sn
	UNION
	SELECT name as ID, pin as f01, 
	date_part('year',MAX(event_time)) as f02, 
	date_part('month',MAX(event_time)) as f03, 
	date_part('day',MAX(event_time)) as f04, 
	date_part('hour',MAX(event_time)) as f05, 
	date_part('minute',MAX(event_time)) as f06, 
	NULL as f07, NULL as f08, NULL as f09, 
	RIGHT(dev_sn,4) as f10, 
	NULL as crtdt, NULL as flag
	FROM acc_transaction where split_part(dev_alias, '-', 1)='OUT' and pin != '' and event_time >= '${start}' and event_time <= '${end}' and verify_mode_no != 4
	GROUP BY pin,name,dev_sn
	UNION
	SELECT name as ID, pin as f01, 
	date_part('year',MIN(event_time)) as f02, 
	date_part('month',MIN(event_time)) as f03, 
	date_part('day',MIN(event_time)) as f04, 
	date_part('hour',MIN(event_time)) as f05, 
	date_part('minute',MIN(event_time)) as f06, 
	NULL as f07, NULL as f08, NULL as f09, 
	RIGHT(dev_sn,4) as f10, 
	NULL as crtdt, NULL as flag
	FROM acc_transaction where dev_alias in ('Office','Poliklinik') and pin!= '' and event_time >= '${start}' and event_time <= '${end}'
	GROUP BY pin,name,dev_sn
	UNION
	SELECT name as ID, pin as f01, 
	date_part('year',MAX(event_time)) as f02, 
	date_part('month',MAX(event_time)) as f03, 
	date_part('day',MAX(event_time)) as f04, 
	date_part('hour',MAX(event_time)) as f05, 
	date_part('minute',MAX(event_time)) as f06, 
	NULL as f07, NULL as f08, NULL as f09, 
	RIGHT(dev_sn,4) as f10, 
	NULL as crtdt, NULL as flag
	FROM acc_transaction where dev_alias in ('Office','Poliklinik') and pin != '' and event_time >= '${start}' and event_time <= '${end}'
	GROUP BY pin,name,dev_sn
	ORDER BY f02 asc,f03 asc,f04 asc,f05 asc, f06 asc
	`;
}

const zeroPadding = str => {
	if (String(str).length < 2) {
		return `0${str}`;
	}
	return String(str);
}

const getData = async (start,end,response = 0,closeServer = 1) => {
	await console.log(`-> Sending Data from ${start} until ${end}`);
	await pool.query(query_(start,end), (error, results) => {
		if (error) throw error;
		if (results.rows.length > 0) {
			const dataSend = [];
			const toInsert = results.rows;
			console.log(`[SENDING] Sending Data [${results.rows.length} row(s)]........`);
			let SAPtoSent = '';
			const logGET = [];
			toInsert.map((row,idx) => {
				if (row.f01.length < 8) {
					let zero = ``,i = row.f01.length;
					for (i; i < 8; i++) {
						zero+='0';
					}
					row.f01 = `${zero}${row.f01}`;
				}
				row.f03 = zeroPadding(row.f03);
				row.f04 = zeroPadding(row.f04);
				row.f05 = zeroPadding(row.f05);
				row.f06 = zeroPadding(row.f06);
			});
			toInsert.forEach((row,idx) => {
				const rowSAP = {
					ID: row.id,
					f01: row.f01,
					f02: row.f02,
					f03: row.f03,
					f04: row.f04,
					f05: row.f05,
					f06: row.f06,
					f07: `NULL`,
					f08: `NULL`,
					f09: `NULL`,
					f10: row.f10,
					f11: `NULL`,
					f12: `NULL`
				};
				const searchData = logGET.find(obj => obj.nik == row.f01);
				if (!searchData) {
					logGET.push({nik:row.f01, row:[rowSAP]});
				} else {
					logGET.map(brs => {
						if (brs.nik == row.f01) {
							if (brs.row.length < 2) {
								brs.row.push(rowSAP);
							} else {
								brs.row.pop();
								brs.row.push(rowSAP);
							}
						}
					});
				}
			});
			logGET.forEach(dataSAP => {
				dataSAP.row.forEach(row => {
					SAPtoSent+= `INSERT INTO ${SAPtable} (ID,f01,f02,f03,f04,f05,f06,f07,f08,f09,f10,crtdt,flag) VALUES ('${row.ID}','${row.f01}','${row.f02}','${row.f03}','${row.f04}','${row.f05}','${row.f06}',NULL,NULL,NULL,'${row.f10}',NULL,NULL);\n`;
				})
			});
			// fs.writeFile(`${dir}log_sap_get_${start}_${end}.txt`,JSON.stringify(toInsert,null,2), err => {
			// 	if (err) {
			// 		console.log(err);
			// 	} else {
			// 		console.log(`[SAVED] Log Data for Getting SAP Saved........!!`);
			// 	}
			// });
			// fs.writeFile(`${dir}log_sap_sent_${start}_${end}_logGET.txt`,JSON.stringify(logGET,null,2), err => {
			// 	if (err) {
			// 		console.log(err);
			// 	} else {
			// 		console.log(`[SAVED] Log Data for Log Filter SAP Saved........!!`);
			// 	}
			// });
			// fs.writeFile(`${dir}log_sap_sent_${start}_${end}_sent.txt`,SAPtoSent, err => {
			// 	if (err) {
			// 		console.log(err);
			// 	} else {
			// 		console.log(`[SAVED] Log Data for Sent SAP Saved........!!`);
			// 	}
			// });
			const connection = new Connection(conf_sqlsrv(DB_SAP));
			connection.connect();
			connection.on('connect', (err) => {
				console.log(`[CONNECT] Connecting to ${conf_sqlsrv(DB_SAP).server}........`);
				if (err) {
					console.log(err);
					if (response != 0) {
						response.send(err);
					}
				} else {
					let sap_status;
					console.log('[CONNECT] Connected........!!');
					let querySAP = `INSERT INTO ${SAPtable} (ID,f01,f02,f03,f04,f05,f06,f07,f08,f09,f10,crtdt,flag) SELECT * FROM (VALUES ${SAPtoSent}) AS temp (ID,f01,f02,f03,f04,f05,f06,f07,f08,f09,f10,crtdt,flag)`;
					const req_ = new Request(SAPtoSent, (error,rowCount,rows) => {
						if (error) {
							console.log(error);
						} else {
							// fs.writeFile(`${dir}log_sap_sent_${start}_${end}.txt`,SAPtoSent, err => {
							// 	if (err) {
							// 		console.log(err);
							// 	} else {
							// 		console.log(`[SAVED] Log Data for Sending SAP Saved........!!`);
							// 	}
							// });
							console.log(`[DONE] ${rowCount} row(s) inserted`);
							console.log(`[DONE] SAP SENT!!`);
							sap_status = {message:"SAP SENT!!"};
						}
					});
					req_.on('doneProc', () => {
						pool.query(`INSERT INTO sys_sent_log (start_send,end_send) VALUES ('${start}','${end}');`, (error, results) => {
							if (error) {
								console.log(error);
								if (response != 0) {
									response.send(error);
								}
							} else {
								console.log(`[DONE] Log Noted!!`);
								if (response != 0) {
									response.status(200).json({
										log: "Log Noted!!",
										sap_status
									});
								}
							}
							if (closeServer == 1) {
								closeApp();
							}
						});
					});
					connection.execSql(req_);
				}
			});
		} else {
			console.log(`[EMPTY] NO DATA FOUND!!`);
			if (closeServer == 1) {
				closeApp();
			}
		}
	});
}
const downloadSCH = async () => {
	const connection = new Connection(conf_sqlsrv(DB_SCH));
	await connection.connect();
	await connection.on('connect', (err) => {
		console.log(`[CONNECT] Connecting to ${conf_sqlsrv(DB_SCH).server}........`);
		if (err) {
			console.log(err);
		} else {
			console.log('[CONNECT] Connected........!!');
			let ress = [];
			let tmp = {};
			const minMasuk = 1;
			const maxPulang = 4;
			let qD;
			let closeServer = 0;
			const req_ = new Request(qSch, (error,rowCount,rows) => {
				if (error) {
					console.log({error: error});
				} else {
					// fs.writeFile(`${dir}log_sch_get_${today}.txt`,JSON.stringify(rows,null,4), err => {
					// 	if (err) {
					// 		console.log(err);
					// 	} else {
					// 		console.log(`[SAVED] Log Data for Getting Schedule Saved........!!`);
					// 	}
					// });
					console.log(`[DOWNLOAD] Mengunduh Jadwal ${today} => ${rowCount} Data........!!`);
				}
			});
			req_.on('row',(columns) => {
				tmp = {};
				columns.forEach(row => {
					if (row.metadata.colName == 'PERNR') {
						tmp.pin = row.value;
					}
					if (row.metadata.colName == 'DATE') {
						tmp.date = new Date(row.value).toISOString().split('T')[0];
					}
					if (row.metadata.colName == 'DWS') {
						tmp.dws = row.value.replace(/\s/g,'');
					}
					if (row.metadata.colName == 'STARTTIME') {
						let starttime = row.value;
						// tmp.start = starttime.toISOString().split('T')[1].split('.')[0];
						tmp.start = `${starttime}:00`;
					}
					if (row.metadata.colName == 'ENDTIME') {
						let endtime = row.value;
						// tmp.end = endtime.toISOString().split('T')[1].split('.')[0];
						tmp.end = `${endtime}:00`;
					}
					if (row.metadata.colName == 'PLHRS') {
						tmp.worktime = `${row.value}:00:00`;
						if (String(row.value).lenght < 2) {
							tmp.worktime = `0${row.value}:00:00`;
						}
					}
				});
				ress.push(tmp);
			});
			req_.on('doneProc', () => {
				if (ress.length < 1) {
					console.log(`[EMPTY] NO DATA FOUND!!`);
					closeApp();
				}
				ress.forEach((row,idx)=> {
					let dwsin,dwsout,tmp_dwsout,tmp_start,tmp_end,subMasuk,subPulang,tmpout;
					let tmpSubpY,tmpSubpM,tmpSubpD,tmpSubpH,tmpSubpI,tmpSubpS;
					let tmpSubmY,tmpSubmM,tmpSubmD,tmpSubmH,tmpSubmI,tmpSubmS;
					tmp_start = dwsin = `${row.date} ${row.start}`;
					tmp_dwsout = dwsout = `${row.date} ${row.end}`;
					if (row.start > row.end) {
						tmpout = new Date(tmp_dwsout);
						tmpout.setDate(tmpout.getDate() + 1);
						if (today == tmpout.toISOString().split('T')[0]) {
							tmpout.setDate(tmpout.getDate() + 1);
						}
						tmp_dwsout = dwsout = `${tmpout.toISOString().split('T')[0]} ${row.end}`;
					}
					[tmp_start,tmp_end] = [new Date(dwsin),new Date(dwsout)];
					[tmpSubmY,tmpSubmM,tmpSubmD,tmpSubmH,tmpSubmI,tmpSubmS] = [tmp_start.getFullYear(),tmp_start.getMonth()+1,tmp_start.getDate(),tmp_start.getHours()-minMasuk,tmp_start.getMinutes(),tmp_start.getSeconds()];
					if (tmpSubmH=='-1') {
						tmpSubmH = (24 - minMasuk);
						tmpSubmD = (tmpSubmD - 1);
					}
					[tmpSubpY,tmpSubpM,tmpSubpD,tmpSubpH,tmpSubpI,tmpSubpS] = [tmp_end.getFullYear(),tmp_end.getMonth()+1,tmp_end.getDate(),tmp_end.getHours()+maxPulang,tmp_end.getMinutes(),tmp_end.getSeconds()];
					[subMasuk,subPulang] = [`${tmpSubmY}-${tmpSubmM}-${tmpSubmD} ${tmpSubmH}:${tmpSubmI}:${tmpSubmS}`,`${tmpSubpY}-${tmpSubpM}-${tmpSubpD} ${tmpSubpH}:${tmpSubpI}:${tmpSubpS}`];
					let pin = row.pin;
					if (row.pin[0] == '0') {
						pin = row.pin.slice(1);
					}
					pool.query(`SELECT * FROM sys_sch_users WHERE nik='${pin}' and masuk='${dwsin}' and pulang='${dwsout}' limit 1`, (error, results) => {
						if (error) throw error;
						if (results.rows.length > 0) {
							console.log(`[X]  ${pin} => '${dwsin}' -> '${dwsout}' SUDAH ADA!!`);
							if (idx == ress.length-1) {
								setTimeout(() => {
									console.log('[DONE] Download Jadwal Selesai........!!');
								},1000);
								setTimeout(() => {
									closeApp();
								},5000);
							}
						} else {
							qD = `INSERT INTO sys_sch_users (nik,shift,tanggal,masuk,pulang,shift_code,work_time) VALUES `;
							qD+=`('${pin}','${row.dws}','${row.date}','${dwsin}','${dwsout}','${row.dws}','${row.worktime}');`;
							pool.query(qD, (error, results) => {
								if (error) {
									console.log(error);
								} else {
									console.log(`[O]  ${pin} => '${dwsin}' -> '${dwsout}' BELUM ADA, Mendownload.......`);
									if (idx == ress.length-1) {
										setTimeout(() => {
											console.log('[DONE] Download Jadwal Selesai........!!');
										},1000);
										setTimeout(() => {
											closeApp();
										},5000);
									}
								};
							});
						}
					});
				});
			});
			connection.execSql(req_);
		}
	});
}

if (argv.send || argv.schedule) {
	if (argv.send == '1000') {
		getData(send1000.start,send1000.end);
	} else if (argv.send == '0010') {
		getData(send0010.start,send0010.end);
	} else if (argv.send == 'manual') {
		open(`http://127.0.0.1:${port}/send`);
		console.log('-> Send SAP Manually');
	} else if (argv.send == 'testing') {
		console.log('-> Testing Send SAP');
		getData(whereCond.start,whereCond.end);
	}
	if (argv.schedule) {
		console.log(`-> DOWNLOADING SCHEDULE FOR ${today}`);
		downloadSCH();
	}
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use((req, res, next) => {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT");
	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, contentType,Content-Type, Accept, Authorization");
	next();
});

app.get('/', (req,res) => {
	sendSAP(res);
});

app.get('/data', (req,res) => {
	pool.query(query_(send0010.start,send0010.end), (error, results) => {
		if (error) throw error;
		if (results.rows.length > 0) {
			res.status(200).json(results.rows);
		} else {
			res.status(503).json({
				message: 'No data found'
			});
		}
	});
});
app.get('/mssql', (req,res) => {
	const connection = new Connection(conf_sqlsrv(DB_SCH));
	connection.connect();
	connection.on('connect', (err) => {
		console.log(`Connecting to ${conf_sqlsrv(DB_SCH).server}....`);
		if (err) {
			console.log(err);
			ress.send({err});
		} else {
			console.log('Connected....');
			const req_ = new Request(qSch, (error,rowCount,rows) => {
				if (error) {
					console.log({error: error});
				} else {
					console.log({rowCount: rowCount});
				}
			});
			let ress = [];
			req_.on('row',(columns) => {
				ress.push(columns);
			});
			req_.on('doneProc', () => {
				res.send(ress);
			});
			connection.execSql(req_);
		}
	});
});
app.get('/send', (req,res) => {
	sendSAP(res);
});
app.post('/send', (req,res) => {
	var startSend = req.body.start;
	var endSend = req.body.end;
	getData(startSend,endSend,res,0);
});
app.post('/check', (req,res) => {
	res.json(req.body);
	console.log(`[CHECKING] Checking from ${req.body.start} to ${req.body.end}`);
});
app.post('/search', (req,res) => {
	var startSearch = req.body.start;
	var endSearch = req.body.end;
	var querySearch = `SELECT * FROM sys_sent_log WHERE start_send='${startSearch}' and end_send='${endSearch}'`;
	pool.query(querySearch, (error, results) => {
		if (error) {
			res.status(500).json(error);
			console.log(error);
		} else {
			res.status(200).json(results.rows);
			if (results.rows.length > 1) {
				console.log(`[FOUND] SAP Already Sent.....!!`);
			}
		}
	});
});
app.get('/close', (req,res) => {
	res.type('html');
	res.send(`<script>window.close();</script>`);
	closeApp();
});

const server = app.listen(port, async () => {
	await console.log(`[RUNNING] http://127.0.0.1:${port}`);
});

const sendSAP = (res) => {
	res.sendFile(path.join(__dirname, '/sendsap.html'));
}

const closeApp = async () => {
	await server.close(() => {
		console.log('[CLOSE] Server Terminated........!!');
		process.exit(1);
	});
}